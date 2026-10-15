import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q, one } from "@/lib/db.js";
import { resolveBranchScope } from "@/lib/reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DayBook — ONE branch, ONE date. Opening cash from the signed day-begin,
 * every money movement in order with a running CASH balance, closing from
 * the signed day-end, plus the non-cash section per SLF account.
 */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "reports", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view reports" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  if (!sp.branch || sp.branch === "all")
    return NextResponse.json({ ok: false, reason: "The DayBook reads one branch at a time — choose a branch" }, { status: 400 });
  const scope = resolveBranchScope(actor, sp.branch);
  if (!scope) return NextResponse.json({ ok: false, reason: "That branch is not allotted to you" }, { status: 403 });
  const branchId = scope.ids[0];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date || "") ? sp.date
    : (await one(`SELECT CURRENT_DATE::text AS d`)).d;

  try {
    const cyc = await one(
      `SELECT begin_opening_paise, begin_counted_paise, begin_signed_at, begin_diff_reason,
              end_expected_paise, end_counted_paise, end_variance_paise, end_reason, end_signed_at,
              eb.full_name AS begun_by, ee.full_name AS ended_by
         FROM day_cycle dc
         LEFT JOIN employee eb ON eb.id = dc.begin_signed_by
         LEFT JOIN employee ee ON ee.id = dc.end_signed_by
        WHERE dc.branch_id=$1 AND dc.business_date=$2`, [branchId, date]);

    // E32 №9 (owner, 15 Oct 2026): each payment carries its stored split —
    // charges / penal / interest / principal — read from receipt_appropriation
    const receipts = await q(
      `SELECT r.id, r.receipt_no, r.amount_paise, r.mode, r.utr, r.received_at, r.closes_loan,
              l.loan_no, c.full_name AS customer, c.cust_no, sa.nickname AS slf_account,
              e.full_name AS by_name,
              coalesce((SELECT sum(ra.amount_paise) FROM receipt_appropriation ra WHERE ra.receipt_id=r.id AND ra.bucket IN ('charge','charge_rounding')),0)::bigint AS charges_paise,
              coalesce((SELECT sum(ra.amount_paise) FROM receipt_appropriation ra WHERE ra.receipt_id=r.id AND ra.bucket='penal'),0)::bigint AS penal_paise,
              coalesce((SELECT sum(ra.amount_paise) FROM receipt_appropriation ra WHERE ra.receipt_id=r.id AND ra.bucket='interest'),0)::bigint AS interest_paise,
              coalesce((SELECT sum(ra.amount_paise) FROM receipt_appropriation ra WHERE ra.receipt_id=r.id AND ra.bucket='principal'),0)::bigint AS principal_paise
         FROM receipt r JOIN loan l ON l.id=r.loan_id JOIN customer c ON c.id=l.customer_id
         LEFT JOIN slf_bank_account sa ON sa.id=r.slf_bank_account_id
         LEFT JOIN employee e ON e.id=r.received_by
        WHERE r.branch_id=$1 AND r.business_date=$2 ORDER BY r.id`, [branchId, date]);

    const legs = await q(
      `SELECT dl.id, dl.kind, dl.amount_paise, dl.utr, d.created_at,
              l.loan_no, l.principal_paise, c.full_name AS customer, c.cust_no, sa.nickname AS from_account,
              e.full_name AS by_name, s.code AS scheme_code
         FROM disbursement_leg dl
         JOIN disbursement d ON d.id=dl.disbursement_id
         JOIN loan l ON l.id=d.loan_id
         JOIN customer c ON c.id=l.customer_id
         JOIN scheme_version sv ON sv.id=l.scheme_version_id JOIN scheme s ON s.id=sv.scheme_id
         LEFT JOIN slf_bank_account sa ON sa.id=d.from_slf_account_id
         LEFT JOIN employee e ON e.id=d.created_by
        WHERE l.branch_id=$1 AND d.created_at::date=$2 ORDER BY dl.id`, [branchId, date]);

    const transfers = await q(
      `SELECT ct.id, ct.destination, ct.amount_paise, ct.status, ct.created_at,
              sa.nickname AS to_account, e.full_name AS carrier
         FROM cash_transfer ct
         LEFT JOIN slf_bank_account sa ON sa.id=ct.slf_bank_account_id
         LEFT JOIN employee e ON e.id=ct.carrier_employee_id
        WHERE ct.branch_id=$1 AND ct.created_at::date=$2 ORDER BY ct.id`, [branchId, date]);

    // one ordered movement list; cash rows carry the running balance
    const opening = cyc ? Number(cyc.begin_counted_paise ?? cyc.begin_opening_paise ?? 0) : 0;
    const moves = [
      ...receipts.map(r => ({ t: r.received_at, kind: "receipt", ref: r.receipt_no,
        particulars: `${r.loan_no} · ${r.customer}`, mode: r.mode, utr: r.utr,
        account: r.slf_account, by: r.by_name,
        inPaise: Number(r.amount_paise), outPaise: 0, cash: r.mode === "cash" })),
      ...legs.map(x => ({ t: x.created_at, kind: "disbursement", ref: x.loan_no,
        particulars: `${x.loan_no} · ${x.customer}`, mode: x.kind, utr: x.utr,
        account: x.from_account, by: x.by_name,
        inPaise: 0, outPaise: Number(x.amount_paise), cash: x.kind === "cash" })),
      ...transfers.map(x => ({ t: x.created_at, kind: "cash transfer", ref: `#${x.id}`,
        particulars: `to ${x.destination}${x.to_account ? " · " + x.to_account : ""} (${x.status})`,
        mode: "cash", utr: null, account: x.to_account, by: x.carrier,
        inPaise: 0, outPaise: Number(x.amount_paise), cash: true })),
    ].sort((a, b) => new Date(a.t) - new Date(b.t));
    let bal = opening;
    for (const m of moves) { if (m.cash) bal += m.inPaise - m.outPaise; m.cashBalancePaise = m.cash ? bal : null; }

    // non-cash per SLF account
    const acct = {};
    for (const m of moves) {
      if (m.cash || !m.account) continue;
      acct[m.account] = acct[m.account] || { inPaise: 0, outPaise: 0 };
      acct[m.account].inPaise += m.inPaise; acct[m.account].outPaise += m.outPaise;
    }

    return NextResponse.json({ ok: true, date, scope: scope.label,
      day: cyc ? {
        openingPaise: opening, begunBy: cyc.begun_by, beginSigned: !!cyc.begin_signed_at,
        diffReason: cyc.begin_diff_reason,
        endExpectedPaise: cyc.end_expected_paise == null ? null : Number(cyc.end_expected_paise),
        endCountedPaise: cyc.end_counted_paise == null ? null : Number(cyc.end_counted_paise),
        variancePaise: cyc.end_variance_paise == null ? null : Number(cyc.end_variance_paise),
        endReason: cyc.end_reason, endedBy: cyc.ended_by, endSigned: !!cyc.end_signed_at,
      } : null,
      moves, closingCashPaise: bal,
      // E32 №8: the two blocks the owner asked for — loans given, money collected
      disbursed: legs.map(x => ({ t: x.created_at, loanNo: x.loan_no, customer: x.customer, custNo: x.cust_no,
        scheme: x.scheme_code, principalPaise: Number(x.principal_paise), mode: x.kind,
        account: x.from_account, utr: x.utr, by: x.by_name, amountPaise: Number(x.amount_paise) })),
      collected: receipts.map(r => ({ t: r.received_at, receiptNo: r.receipt_no, loanNo: r.loan_no,
        customer: r.customer, custNo: r.cust_no, mode: r.mode, account: r.slf_account, utr: r.utr, by: r.by_name,
        chargesPaise: Number(r.charges_paise), penalPaise: Number(r.penal_paise),
        interestPaise: Number(r.interest_paise), principalPaise: Number(r.principal_paise),
        amountPaise: Number(r.amount_paise), closes: !!r.closes_loan })),
      accounts: Object.entries(acct).map(([k, v]) => ({ account: k, ...v })) });
  } catch (e) {
    console.error("[reports/daybook] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the report" }, { status: 500 });
  }
}
