import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";
import { dues, roundUp10 } from "@/lib/engine.js";
import { schemeFromRow, replayLoan } from "@/lib/loanstate.js";
import { viewUrl } from "@/lib/s3.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything a loan owes as of today. Nothing is stored: the position is
 * rebuilt from the loan's immutable receipts and charges every time it is
 * asked for, so it can never drift from the evidence.
 */
export async function loadPosition(loanId, branchId) {
  const loan = await one(
    `SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, l.status,
            l.customer_id, l.entity_id, l.branch_id, l.scheme_version_id,
            c.full_name AS customer_name, s.code AS scheme_code, l.application_id
       FROM loan l
       JOIN customer c ON c.id = l.customer_id
       JOIN scheme_version sv ON sv.id = l.scheme_version_id
       JOIN scheme s ON s.id = sv.scheme_id
      WHERE l.id = $1 AND l.branch_id = $2`, [loanId, branchId]);
  if (!loan) return null;

  const sv = await one(`SELECT * FROM scheme_version WHERE id = $1`, [loan.scheme_version_id]);
  const slabs = await q(`SELECT from_day, to_day, rate_pct FROM scheme_slab
                          WHERE scheme_version_id = $1 ORDER BY from_day`, [loan.scheme_version_id]);
  const charges = await q(
    `SELECT lc.id, lc.total_paise, lc.narration, lc.added_at::date AS added_on,
            ct.name AS charge_name
       FROM loan_charge lc JOIN charge_type ct ON ct.id = lc.charge_type_id
      WHERE lc.loan_id = $1 AND lc.removed_at IS NULL
      ORDER BY lc.added_at, lc.id`, [loanId]);
  const receipts = await q(
    `SELECT business_date, amount_paise, closes_loan FROM receipt
      WHERE loan_id = $1 ORDER BY business_date, id`, [loanId]);

  const scheme = schemeFromRow(sv, slabs, loan.scheme_code);
  const state = replayLoan({ principalPaise: loan.principal_paise,
    disbursedAt: loan.disbursed_at, scheme, charges, receipts });

  return { loan, scheme, state, charges, receiptCount: receipts.length };
}

export async function GET(req, { params }) {
  try {
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
    if (!can(actor, "collect", { need: "view" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not view collections" }, { status: 403 });

    const { id } = await params;
    const pos = await loadPosition(Number(id), actor.actingBranchId);
    if (!pos) return NextResponse.json({ ok: false, reason: "Loan not found at this branch" }, { status: 404 });
    if (pos.loan.status !== "active")
      return NextResponse.json({ ok: false, reason: `This loan is ${pos.loan.status}` }, { status: 409 });

    const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
    // Two views: what is owed on a running loan, and what it would take to close
    // today. The minimum-interest floor and the grace forgiveness only apply to
    // the second, so both have to be computed.
    // №17 — the gold being redeemed, and who co-signed for it
    const orn = await one(
      `SELECT fo.thumb_s3_key, fo.s3_key FROM application_photo ap
         JOIN file_object fo ON fo.id = ap.file_id
        WHERE ap.application_id = $1 ORDER BY ap.ord LIMIT 1`, [pos.loan.application_id]);
    const ornamentPhotoUrl = orn
      ? await viewUrl(orn.thumb_s3_key || orn.s3_key).catch(() => null) : null;
    const cob = await one(
      `SELECT c.full_name, c.cust_no FROM loan_application la
         JOIN customer c ON c.id = la.coborrower_customer_id
        WHERE la.id = $1 AND la.coborrower_customer_id IS NOT NULL`, [pos.loan.application_id]);

    const running = dues(pos.scheme, pos.state, today);
    const closing = dues(pos.scheme, pos.state, today, { closing: true });

    const cashToday = await one(
      `SELECT coalesce(sum(r.amount_paise), 0)::bigint AS paise
         FROM receipt r JOIN loan l ON l.id = r.loan_id
        WHERE l.customer_id = $1 AND r.mode = 'cash' AND r.business_date = CURRENT_DATE`,
      [pos.loan.customer_id]);

    // E17 №2 (owner, 29 Aug 2026): UPI/bank repayments must name the SLF
    // account that received the money — offer the branch's collection accounts.
    const slfAccounts = await q(
      `SELECT a.id, a.nickname FROM slf_bank_account a
        WHERE a.active AND a.allow_collection
          AND (a.scope_all OR EXISTS (SELECT 1 FROM slf_bank_account_branch ab
                                       WHERE ab.account_id = a.id AND ab.branch_id = $1))
        ORDER BY a.nickname`, [actor.actingBranchId]);

    return NextResponse.json({ ok: true, today,
      slfAccounts: slfAccounts.map(a => ({ id: Number(a.id), nickname: a.nickname })),
      loan: { id: pos.loan.id, loanNo: pos.loan.loan_no, customerName: pos.loan.customer_name,
        customerId: pos.loan.customer_id,   // for "Back to customer" after a receipt
        schemeCode: pos.loan.scheme_code, disbursedAt: pos.loan.disbursed_at,
        ornamentPhotoUrl, coborrowerName: cob ? cob.full_name : null,
        coborrowerCustNo: cob ? cob.cust_no : null },
      // balancePaise is what is still payable on each charge — its own rounded
      // figure (R-D) less whatever has already been received against it.
      charges: pos.charges.map(c => {
        const live = pos.state.charges.find(x => String(x.id) === String(c.id));
        const payable = roundUp10(Number(c.total_paise));
        const paid = live ? live.paidExact : 0;
        return { id: c.id, name: c.charge_name, narration: c.narration, addedOn: c.added_on,
          amountPaise: Number(c.total_paise), payablePaise: payable,
          balancePaise: Math.max(0, payable - paid) };
      }),
      running, closing,
      cashAlreadyTodayPaise: Number(cashToday.paise),
      canCollect: can(actor, "collect", { need: "full" }).ok });
  } catch (e) {
    console.error("[dues] failed", e);
    return NextResponse.json({ ok: false, reason: e.message || "Could not price this loan" }, { status: 500 });
  }
}
