import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q } from "@/lib/db.js";
import { resolveBranchScope, resolvePeriod } from "@/lib/reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Loan Repay Register (MIS) — one row per receipt, with the STORED
 * appropriation split (charges / rounding / penal / interest / principal);
 * never recomputed by a later engine.
 */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "reports", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view reports" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = resolveBranchScope(actor, sp.branch);
  if (!scope) return NextResponse.json({ ok: false, reason: "That branch is not allotted to you" }, { status: 403 });
  const { from, to } = await resolvePeriod(sp);

  try {
    const params = [scope.ids, from, to];
    let extra = "";
    if (sp.mode) { params.push(sp.mode); extra += ` AND r.mode = $${params.length}`; }
    if (sp.account) { params.push(Number(sp.account)); extra += ` AND r.slf_bank_account_id = $${params.length}`; }
    if (sp.closes === "1") extra += ` AND r.closes_loan`;

    const rows = await q(
      `SELECT r.receipt_no, r.business_date::text AS on_date, r.amount_paise, r.mode, r.utr,
              r.closes_loan, r.is_exact_settlement,
              b.code AS branch_code, b.name AS branch_name,
              l.loan_no, c.cust_no, c.full_name AS customer, c.mobile,
              e.full_name AS received_by, sa.nickname AS slf_account,
              coalesce(ap.charge,0)::bigint AS charge_paise,
              coalesce(ap.rounding,0)::bigint AS rounding_paise,
              coalesce(ap.penal,0)::bigint AS penal_paise,
              coalesce(ap.interest,0)::bigint AS interest_paise,
              coalesce(ap.principal,0)::bigint AS principal_paise
         FROM receipt r
         JOIN branch b ON b.id = r.branch_id
         JOIN loan l ON l.id = r.loan_id
         JOIN customer c ON c.id = l.customer_id
         LEFT JOIN employee e ON e.id = r.received_by
         LEFT JOIN slf_bank_account sa ON sa.id = r.slf_bank_account_id
         LEFT JOIN LATERAL (
           SELECT sum(amount_paise) FILTER (WHERE bucket='charge') AS charge,
                  sum(amount_paise) FILTER (WHERE bucket='charge_rounding') AS rounding,
                  sum(amount_paise) FILTER (WHERE bucket='penal') AS penal,
                  sum(amount_paise) FILTER (WHERE bucket='interest') AS interest,
                  sum(amount_paise) FILTER (WHERE bucket='principal') AS principal
             FROM receipt_appropriation ra WHERE ra.receipt_id = r.id) ap ON TRUE
        WHERE r.branch_id = ANY($1::bigint[])
          AND r.business_date BETWEEN $2 AND $3 ${extra}
        ORDER BY r.business_date, r.branch_id, r.id
        LIMIT 5000`, params);

    return NextResponse.json({ ok: true, from, to, scope: scope.label,
      rows: rows.map(r => ({ receiptNo: r.receipt_no, onDate: r.on_date,
        branch: `${r.branch_code} ${r.branch_name}`,
        loanNo: r.loan_no, custNo: r.cust_no, customer: r.customer, mobile: r.mobile,
        mode: r.mode, utr: r.utr, slfAccount: r.slf_account,
        amountPaise: Number(r.amount_paise),
        chargePaise: Number(r.charge_paise), roundingPaise: Number(r.rounding_paise),
        penalPaise: Number(r.penal_paise), interestPaise: Number(r.interest_paise),
        principalPaise: Number(r.principal_paise),
        closesLoan: r.closes_loan, exactSettlement: r.is_exact_settlement,
        receivedBy: r.received_by })) });
  } catch (e) {
    console.error("[reports/repay] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the report" }, { status: 500 });
  }
}
