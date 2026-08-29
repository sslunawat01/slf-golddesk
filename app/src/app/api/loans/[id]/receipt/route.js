import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, issueNumber, audit } from "@/lib/db.js";
import { dues, applyPayment } from "@/lib/engine.js";
import { chargeSnapshot, appropriationRows, cashCapCheck, utrCheck, ENGINE_VERSION }
  from "@/lib/loanstate.js";
import { loadPosition } from "../dues/route.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };

const MODES = ["cash", "upi", "bank"];

/**
 * Receive a payment. Every receipt is dated TODAY — backdating is not possible
 * from the counter by decision of the owner (27 July 2026), because a payment
 * dated backwards silently reduces interest and breaks day-end reconciliation.
 */
export async function POST(req, { params }) {
  try {
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
    if (!can(actor, "collect", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not receive payments" }, { status: 403 });

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "");
    const utr = String(body.utr || "").trim();
    const amountPaise = Math.round(Number(body.amountPaise || 0));
    const closing = !!body.closing;
    const paidBy = String(body.paidBy || "").trim().slice(0, 80) || null;   // №18

    if (!MODES.includes(mode))
      return NextResponse.json({ ok: false, reason: "Choose how the customer is paying" }, { status: 400 });
    const u = utrCheck(mode, utr);
    // №2 (owner, 29 Aug 2026): non-cash money must land somewhere named
    let slfAccountId = null;
    if (mode !== "cash") {
      slfAccountId = Number(body.slfBankAccountId) || null;
      if (!slfAccountId)
        return NextResponse.json({ ok: false,
          reason: "Choose which SLF account received the money" }, { status: 400 });
      const acc = await one(
        `SELECT a.id FROM slf_bank_account a
          WHERE a.id=$1 AND a.active AND a.allow_collection
            AND (a.scope_all OR EXISTS (SELECT 1 FROM slf_bank_account_branch ab
                                         WHERE ab.account_id=a.id AND ab.branch_id=$2))`,
        [slfAccountId, actor.actingBranchId]);
      if (!acc)
        return NextResponse.json({ ok: false,
          reason: "That SLF account cannot take collections for this branch" }, { status: 400 });
    }
    if (!u.ok) return NextResponse.json({ ok: false, reason: u.reason }, { status: 400 });
    if (amountPaise <= 0)
      return NextResponse.json({ ok: false, reason: "Enter the amount received" }, { status: 400 });

    const pos = await loadPosition(Number(id), actor.actingBranchId);
    if (!pos) return NextResponse.json({ ok: false, reason: "Loan not found at this branch" }, { status: 404 });
    if (pos.loan.status !== "active")
      return NextResponse.json({ ok: false, reason: `This loan is ${pos.loan.status}` }, { status: 409 });

    const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;

    if (mode === "cash") {
      const cashToday = await one(
        `SELECT coalesce(sum(r.amount_paise), 0)::bigint AS paise
           FROM receipt r JOIN loan l ON l.id = r.loan_id
          WHERE l.customer_id = $1 AND r.mode = 'cash' AND r.business_date = CURRENT_DATE`,
        [pos.loan.customer_id]);
      const cap = cashCapCheck({ alreadyTodayPaise: Number(cashToday.paise), amountPaise });
      if (!cap.ok) return NextResponse.json({ ok: false, reason: cap.reason }, { status: 400 });
    }

    // The engine is the only judge of the amount. It is priced again here from
    // the replayed state — never from a figure the browser sent us.
    const d = dues(pos.scheme, pos.state, today, { closing });
    const isExact = amountPaise === d._paise.settlement;
    const before = chargeSnapshot(pos.state);

    let receipt;
    try {
      ({ receipt } = applyPayment(pos.scheme, pos.state,
        { date: today, amount: amountPaise / 100, closing }));
    } catch (e) {
      return NextResponse.json({ ok: false, reason: e.message }, { status: 400 });
    }
    const rows = appropriationRows(before, pos.state, receipt);
    const closes = !!receipt.closing;

    const out = await tx(async (cl) => {
      const receiptNo = await issueNumber(cl, { entityId: pos.loan.entity_id,
        branchId: pos.loan.branch_id, docType: "receipt", fy: fy() });

      const { rows: [r] } = await cl.query(
        `INSERT INTO receipt (receipt_no, entity_id, branch_id, loan_id, business_date,
           amount_paise, mode, utr, is_exact_settlement, closes_loan, seals_cycle,
           engine_version, received_by, paid_by, slf_bank_account_id)
         VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6::pay_mode,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [receiptNo, pos.loan.entity_id, pos.loan.branch_id, pos.loan.id, amountPaise,
         mode, mode === "cash" ? (utr || null) : utr, isExact, closes,
         !!receipt.sealsCycle, ENGINE_VERSION, actor.employeeId, paidBy, slfAccountId]);

      for (const a of rows)
        await cl.query(
          `INSERT INTO receipt_appropriation (receipt_id, bucket, loan_charge_id, amount_paise)
           VALUES ($1,$2::approp_bucket,$3,$4)`,
          [r.id, a.bucket, a.loanChargeId, a.amountPaise]);

      if (closes) {
        await cl.query(`UPDATE loan SET status='closed', closed_at=CURRENT_DATE, updated_by=$2 WHERE id=$1`,
          [pos.loan.id, actor.employeeId]);
        await cl.query(
          `INSERT INTO loan_state_history (loan_id, from_state, to_state, by_employee, note)
           VALUES ($1,'active','closed',$2,$3)`,
          [pos.loan.id, actor.employeeId, `settled in full by receipt ${receiptNo}`]);
      }

      // The cache is a convenience, never the truth — it is simply overwritten.
      const after = dues(pos.scheme, pos.state, today);
      await cl.query(
        `INSERT INTO loan_accrual_cache (loan_id, as_of, cycle_anchor, penal_anchor,
           interest_due_paise, penal_due_paise, lifetime_interest_paid_paise, engine_version)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (loan_id) DO UPDATE SET as_of=EXCLUDED.as_of,
           cycle_anchor=EXCLUDED.cycle_anchor, penal_anchor=EXCLUDED.penal_anchor,
           interest_due_paise=EXCLUDED.interest_due_paise, penal_due_paise=EXCLUDED.penal_due_paise,
           lifetime_interest_paid_paise=EXCLUDED.lifetime_interest_paid_paise,
           engine_version=EXCLUDED.engine_version, computed_at=now()`,
        [pos.loan.id, pos.state.cycleAnchor, pos.state.penalAnchor,
         after._paise.interestDue, after._paise.penalDue, pos.state.lifetimeInterestPaid,
         ENGINE_VERSION]);

      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "receipt", entityId: Number(r.id), action: closes ? "loan_settled" : "payment_received",
        after: { receiptNo, amountPaise, mode, appropriation: receipt.appropriation,
                 sealsCycle: receipt.sealsCycle, closes } });

      return { receiptId: Number(r.id), receiptNo };
    }, { entityIds: actor.entityIds });

    return NextResponse.json({ ok: true, ...out, closes,
      sealsCycle: !!receipt.sealsCycle, appropriation: receipt.appropriation,
      principalAfter: receipt.principalAfter });
  } catch (e) {
    console.error("[receipt] failed", e);
    return NextResponse.json({ ok: false,
      reason: "The payment failed — " + (e.message || "unknown error") + " (nothing was saved)" },
      { status: 500 });
  }
}
