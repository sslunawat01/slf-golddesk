import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q, one } from "@/lib/db.js";
import { resolveBranchScope } from "@/lib/reports.js";
import { dues } from "@/lib/engine.js";
import { schemeFromRow, replayLoan, RECEIPTS_FOR_REPLAY_SQL } from "@/lib/loanstate.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Loan Details — the full dossier of ONE loan: facts, parties, scheme terms,
 * ornaments, disbursement legs, receipts with their stored appropriation
 * split, charges, state history, custody chain, release. Printable.
 */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "reports", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view reports" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = resolveBranchScope(actor, "all");
  if (!scope) return NextResponse.json({ ok: false, reason: "No branches allotted" }, { status: 403 });
  const key = String(sp.loanNo || "").trim();
  if (!key) return NextResponse.json({ ok: false, reason: "Type a loan number" }, { status: 400 });

  try {
    const loan = await one(
      `SELECT l.*, b.code AS branch_code, b.name AS branch_name,
              c.cust_no, c.full_name AS customer, c.mobile,
              sv.id AS svid, sv.version_no, sv.round_step_paise, sv.days_in_year, sv.calc_method,
              sv.min_interest_days, sv.tenure_days, sv.penal_rate_pct, sv.penal_grace_days,
              sv.interest_pct, sv.slab_mode, sv.funding_pct,
              s.code AS scheme_code, s.name AS scheme_name, la.remark AS app_remark,
              (CURRENT_DATE - l.disbursed_at)::int + 1 AS age_days
         FROM loan l
         JOIN loan_application la ON la.id=l.application_id
         JOIN branch b ON b.id=l.branch_id
         JOIN customer c ON c.id=l.customer_id
         JOIN scheme_version sv ON sv.id=l.scheme_version_id
         JOIN scheme s ON s.id=sv.scheme_id
        WHERE upper(l.loan_no) = upper($1)`, [key]);
    if (!loan) return NextResponse.json({ ok: false, reason: `No loan ${key}` }, { status: 404 });
    if (!scope.ids.includes(Number(loan.branch_id)))
      return NextResponse.json({ ok: false,
        reason: `Loan ${loan.loan_no} belongs to ${loan.branch_code} ${loan.branch_name} — not a branch allotted to you` },
        { status: 403 });

    const [items, legs, receipts, appropriations, charges, history, custody, release] = await Promise.all([
      q(`SELECT ai.qty, ai.gross_mg, ai.stone_mg, ai.net_mg, ai.purity_pct_snapshot,
                ai.funding_paise, i.name AS item, p.karat
           FROM appraisal_item ai JOIN item i ON i.id=ai.item_id
           LEFT JOIN purity p ON p.id=ai.purity_id
          WHERE ai.application_id=$1 ORDER BY ai.id`, [loan.application_id]),
      q(`SELECT dl.kind, dl.amount_paise, dl.utr, d.created_at, sa.nickname AS from_account,
                cba.bank, cba.account_no, e.full_name AS by_name,
                ua.full_name AS unverified_ack_name               -- E29
           FROM disbursement_leg dl JOIN disbursement d ON d.id=dl.disbursement_id
           LEFT JOIN employee ua ON ua.id = dl.unverified_ack_by
           LEFT JOIN slf_bank_account sa ON sa.id=d.from_slf_account_id
           LEFT JOIN customer_bank_account cba ON cba.id=dl.customer_bank_account_id
           LEFT JOIN employee e ON e.id=d.created_by
          WHERE d.loan_id=$1 ORDER BY dl.id`, [loan.id]),
      q(`SELECT r.id, r.receipt_no, r.business_date::text AS d, r.amount_paise, r.mode, r.utr,
                r.closes_loan, r.seals_cycle, sa.nickname AS slf_account, e.full_name AS by_name
           FROM receipt r LEFT JOIN slf_bank_account sa ON sa.id=r.slf_bank_account_id
           LEFT JOIN employee e ON e.id=r.received_by
          WHERE r.loan_id=$1 ORDER BY r.business_date, r.id`, [loan.id]),
      q(`SELECT ra.receipt_id, ra.bucket, sum(ra.amount_paise)::bigint AS amt
           FROM receipt_appropriation ra JOIN receipt r ON r.id=ra.receipt_id
          WHERE r.loan_id=$1 GROUP BY ra.receipt_id, ra.bucket`, [loan.id]),
      q(`SELECT lc.total_paise, lc.base_paise, lc.gst_paise, lc.narration,
                lc.added_at::date::text AS added_on, lc.removed_at, ct.name
           FROM loan_charge lc JOIN charge_type ct ON ct.id=lc.charge_type_id
          WHERE lc.loan_id=$1 ORDER BY lc.added_at`, [loan.id]),
      q(`SELECT h.from_state, h.to_state, h.at, h.note, e.full_name AS by_name
           FROM loan_state_history h LEFT JOIN employee e ON e.id=h.by_employee
          WHERE h.loan_id=$1 OR h.application_id=$2 ORDER BY h.at, h.id`, [loan.id, loan.application_id]),
      q(`SELECT vm.direction, vm.at AS moved_at, vm.reason, s2.label AS safe, e.full_name AS by_name
           FROM vault_movement vm
           JOIN packet pk ON pk.id=vm.packet_id AND pk.loan_id=$1
           LEFT JOIN safe s2 ON s2.id=vm.safe_id
           LEFT JOIN employee e ON e.id=vm.by_employee
          ORDER BY vm.at`, [loan.id]),
      one(`SELECT rl.due_from::text AS due_from, rl.released_at, rl.noc_no,
                  e.full_name AS released_by
             FROM release rl LEFT JOIN employee e ON e.id=rl.released_by
            WHERE rl.loan_id=$1`, [loan.id]).catch(() => null),
    ]);

    // live position (active loans only) — same replay as the collect screen
    let position = null;
    if (loan.status === "active") {
      const slabs = await q(`SELECT from_day, to_day, rate_pct FROM scheme_slab
                              WHERE scheme_version_id=$1 ORDER BY from_day`, [loan.svid]);
      const chg = await q(`SELECT lc.id, lc.total_paise, lc.added_at::date::text AS added_on
                             FROM loan_charge lc WHERE lc.loan_id=$1 AND lc.removed_at IS NULL`, [loan.id]);
      const rec = await q(RECEIPTS_FOR_REPLAY_SQL, [loan.id]);
      const scheme = schemeFromRow(loan, slabs, loan.scheme_code);
      const state = replayLoan({ principalPaise: loan.principal_paise,
        disbursedAt: loan.disbursed_at, scheme, charges: chg, receipts: rec });
      const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
      const d = dues(scheme, state, today);
      position = { asOn: today, principalPaise: Number(state.principal),   // already paise (E27b)
        interestPaise: d._paise.interestDue, penalPaise: d._paise.penalDue,
        chargesPaise: d._paise.chargesDue,
        totalDuePaise: Number(state.principal) + d._paise.interestDue
          + d._paise.penalDue + d._paise.chargesDue };
    }

    const apBy = {};
    for (const a of appropriations)
      (apBy[a.receipt_id] = apBy[a.receipt_id] || {})[a.bucket] = Number(a.amt);

    return NextResponse.json({ ok: true,
      loan: { loanNo: loan.loan_no, status: loan.status,
        branch: `${loan.branch_code} ${loan.branch_name}`,
        custNo: loan.cust_no, customer: loan.customer, mobile: loan.mobile,
        scheme: `${loan.scheme_code} — ${loan.scheme_name} (v${loan.version_no})`,
        principalPaise: Number(loan.principal_paise), remark: loan.app_remark || null,
        disbursedAt: loan.disbursed_at, closedAt: loan.closed_at,
        ageDays: Number(loan.age_days),
        terms: { calc: loan.calc_method,
          interestPct: loan.interest_pct == null ? null : Number(loan.interest_pct),
          tenureDays: Number(loan.tenure_days), minInterestDays: Number(loan.min_interest_days),
          penalRatePct: Number(loan.penal_rate_pct || 0), penalGraceDays: Number(loan.penal_grace_days || 0),
          fundingPct: Number(loan.funding_pct || 0), daysInYear: Number(loan.days_in_year) } },
      position,
      items: items.map(i => ({ item: i.item, karat: i.karat, qty: i.qty,
        grossMg: Number(i.gross_mg), stoneMg: Number(i.stone_mg), netMg: Number(i.net_mg),
        purityPct: Number(i.purity_pct_snapshot),
        fundingPaise: Number(i.funding_paise) })),
      legs: legs.map(x => ({ kind: x.kind, amountPaise: Number(x.amount_paise), utr: x.utr,
        on: x.created_at, fromAccount: x.from_account,
        toAccount: x.bank ? `${x.bank} …${String(x.account_no || "").slice(-4)}` : null, by: x.by_name,
        unverifiedAckBy: x.unverified_ack_name || null })),
      receipts: receipts.map(r => ({ receiptNo: r.receipt_no, onDate: r.d,
        amountPaise: Number(r.amount_paise), mode: r.mode, utr: r.utr,
        slfAccount: r.slf_account, closesLoan: r.closes_loan, sealsCycle: r.seals_cycle,
        by: r.by_name, split: apBy[r.id] || {} })),
      charges: charges.map(c => ({ name: c.name, addedOn: c.added_on,
        basePaise: Number(c.base_paise), gstPaise: Number(c.gst_paise),
        totalPaise: Number(c.total_paise), narration: c.narration, removed: !!c.removed_at })),
      history: history.map(h => ({ fromState: h.from_state, toState: h.to_state,
        at: h.at, by: h.by_name, note: h.note })),
      custody: custody.map(v => ({ direction: v.direction, at: v.moved_at, safe: v.safe, by: v.by_name })),
      release: release ? { dueFrom: release.due_from, releasedAt: release.released_at,
        nocNo: release.noc_no, by: release.released_by } : null });
  } catch (e) {
    console.error("[reports/loandetails] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the dossier" }, { status: 500 });
  }
}
