import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can, sanctionAuthority, needsHoApproval } from "@/lib/policy.js";
import { one, q, tx, issueNumber, audit } from "@/lib/db.js";
import { validPrincipal, valuerRule, disbursementPlan, docCharge, appraisalTotals } from "@/lib/valuation.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };

/** Load an application with everything the rules need to judge it. */
async function loadApp(id, branchId) {
  const app = await one(
    `SELECT a.*, sv.funding_pct, sv.min_loan_paise, sv.max_loan_paise, sv.doc_charge_pct,
            sv.doc_charge_min_paise, sv.doc_charge_max_paise, sv.tenure_days, s.code AS scheme_code
       FROM loan_application a
       LEFT JOIN scheme_version sv ON sv.id = a.scheme_version_id
       LEFT JOIN scheme s ON s.id = sv.scheme_id
      WHERE a.id = $1 AND a.branch_id = $2`, [id, branchId]);
  if (!app) return null;
  const items = await q(`SELECT * FROM appraisal_item WHERE application_id = $1`, [id]);
  const photos = await q(`SELECT file_id FROM application_photo WHERE application_id = $1`, [id]);
  return { app, items, photos };
}

export async function POST(req, { params }) {
  try {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  const loaded = await loadApp(id, actor.actingBranchId);
  if (!loaded) return NextResponse.json({ ok: false, reason: "Application not found" }, { status: 404 });
  const { app, items, photos } = loaded;

  // ————————————————————————— cancel —————————————————————————
  if (action === "cancel") {
    if (!["draft", "appraised", "pending_ho", "approved"].includes(app.status))
      return NextResponse.json({ ok: false, reason: "Nothing to cancel" }, { status: 409 });
    if (!body.narration || body.narration.trim().length < 5)
      return NextResponse.json({ ok: false, reason: "A narration of at least 5 characters is required" }, { status: 400 });
    await tx(async (cl) => {
      await cl.query(`INSERT INTO application_cancellation (application_id, reason, narration, gold_return_photo_id, cancelled_by)
                      VALUES ($1,$2,$3,$4,$5)`,
        [id, body.reason || "not stated", body.narration.trim(), body.goldReturnPhotoId || null, actor.employeeId]);
      await cl.query(`UPDATE loan_application SET status='cancelled', updated_at=now(), updated_by=$2 WHERE id=$1`,
        [id, actor.employeeId]);
      await cl.query(`UPDATE ho_approval SET status='rejected', decided_by=$2, decided_at=now(),
                        reject_reason='application cancelled at branch'
                      WHERE application_id=$1 AND status='waiting'`, [id, actor.employeeId]);
      await cl.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
                      VALUES ($1,$2,'cancelled',$3,$4)`, [id, app.status, actor.employeeId, body.narration.trim()]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "loan_application", entityId: Number(id), action: "application_cancelled",
        after: { reason: body.reason, narration: body.narration } });
    }, { entityIds: actor.entityIds });
    return NextResponse.json({ ok: true, status: "cancelled" });
  }

  // ———————————————————————— withdraw ————————————————————————
  if (action === "withdraw") {
    if (!can(actor, "appraise", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "Not permitted" }, { status: 403 });
    if (app.status !== "pending_ho")
      return NextResponse.json({ ok: false,
        reason: app.status === "approved"
          ? "This file is already approved — its amount can no longer be changed. Cancel it and raise a new pledge."
          : `Application is ${app.status} — there is nothing to withdraw` }, { status: 409 });

    let pulled = 0;
    await tx(async (cl) => {
      const r = await cl.query(
        `UPDATE ho_approval SET status='withdrawn', decided_at=now(),
                reject_reason='withdrawn by the branch before a decision was taken'
          WHERE application_id=$1 AND status='waiting'`, [id]);
      pulled = r.rowCount;
      if (!pulled) return;
      await cl.query(`UPDATE loan_application SET status='appraised', updated_at=now(), updated_by=$2 WHERE id=$1`,
        [id, actor.employeeId]);
      await cl.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
                      VALUES ($1,'pending_ho','appraised',$2,$3)`,
        [id, actor.employeeId, String(body.narration || "withdrawn at the branch to amend the amount").trim()]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "loan_application", entityId: Number(id), action: "withdrawn_from_ho",
        after: { previousAmountPaise: Number(app.requested_paise || 0) } });
    }, { entityIds: actor.entityIds });

    if (!pulled) return NextResponse.json({ ok: false,
      reason: "Head Office has already decided this file — it can no longer be withdrawn" }, { status: 409 });
    return NextResponse.json({ ok: true, status: "appraised" });
  }

  // ————————————————————————— submit —————————————————————————
  if (action === "submit") {
    if (!can(actor, "appraise", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "Not permitted" }, { status: 403 });
    if (!["draft", "appraised"].includes(app.status))
      return NextResponse.json({ ok: false, reason: `Already ${app.status}` }, { status: 409 });

    const problems = [];
    if (!app.scheme_version_id) problems.push("choose a scheme");
    if (!items.length) problems.push("add at least one ornament");
    if (!photos.length) problems.push("photograph the ornaments");
    if (!app.borrower_present && !app.coborrower_customer_id)
      problems.push("borrower absent — a co-borrower is required");
    if (app.borrower_present && !app.presence_photo_id) problems.push("capture the borrower's photo");

    const totals = appraisalTotals(items.map(i => ({
      qty: i.qty, grossMg: i.gross_mg, stoneMg: i.stone_mg, netMg: i.net_mg,
      marketPaise: Number(i.market_paise), fundingPaise: Number(i.funding_paise) })));
    const principal = Number(app.requested_paise || 0);
    const pv = validPrincipal(principal, {
      maxFundingPaise: totals.fundingPaise,
      minLoanPaise: Number(app.min_loan_paise || 0),
      maxLoanPaise: Number(app.max_loan_paise || 0) || Infinity });
    if (!pv.ok) problems.push(pv.reason);

    const thr = Number((await one(`SELECT value FROM app_setting WHERE key='valuer2_threshold_paise'`))?.value ?? 2000000);
    const vr = valuerRule(principal, thr, app.valuer1_id, app.valuer2_id);
    if (!vr.ok) problems.push(vr.reason);

    if (problems.length) return NextResponse.json({ ok: false, reason: problems[0], problems }, { status: 400 });

    const needsHo = needsHoApproval(actor, principal);
    const authority = sanctionAuthority(actor);

    await tx(async (cl) => {
      if (needsHo) {
        await cl.query(`INSERT INTO ho_approval (application_id, amount_paise, recommended_by)
                        VALUES ($1,$2,$3) ON CONFLICT (application_id) DO NOTHING`,
          [id, principal, actor.employeeId]);
        await cl.query(`UPDATE loan_application SET status='pending_ho', updated_at=now(), updated_by=$2 WHERE id=$1`,
          [id, actor.employeeId]);
        await cl.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
                        VALUES ($1,$2,'pending_ho',$3,$4)`,
          [id, app.status, actor.employeeId, `above ceiling ${authority.ceilingPaise}`]);
      } else {
        await cl.query(`UPDATE loan_application SET status='approved', updated_at=now(), updated_by=$2 WHERE id=$1`,
          [id, actor.employeeId]);
        await cl.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
                        VALUES ($1,$2,'approved',$3,'within branch authority')`, [id, app.status, actor.employeeId]);
      }
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "loan_application", entityId: Number(id),
        action: needsHo ? "submitted_to_ho" : "approved_at_branch", after: { principal } });
    }, { entityIds: actor.entityIds });

    return NextResponse.json({ ok: true, status: needsHo ? "pending_ho" : "approved", needsHo,
      ceilingPaise: authority.unlimited ? null : authority.ceilingPaise });
  }

  // ———————————————————————— disburse ————————————————————————
  if (action === "sendback") {
    // №11 (owner, 28 Aug 2026): the person at the disburse desk may return an
    // approved file for correction instead of paying it out. The note is
    // compulsory — the branch must know what to fix. The file goes back to
    // "appraised", so weighments and valuation survive and only the details
    // change before a fresh approval.
    if (!can(actor, "disburse", { need: "full" }).ok &&
        !can(actor, "sanction", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not send files back" }, { status: 403 });
    if (app.status !== "approved")
      return NextResponse.json({ ok: false,
        reason: `Only an approved file can be sent back — this one is ${app.status}` }, { status: 409 });
    const note = String(body.note || "").trim();
    if (note.length < 5)
      return NextResponse.json({ ok: false,
        reason: "Write a note of at least 5 characters — the branch must know what to fix" }, { status: 400 });
    await tx(async (cl) => {
      await cl.query(`UPDATE loan_application SET status='appraised', updated_at=now(),
                        updated_by=$2 WHERE id=$1`, [id, actor.employeeId]);
      await cl.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
                      VALUES ($1,'approved','appraised',$2,$3)`,
        [id, actor.employeeId, "sent back for changes: " + note]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "loan_application", entityId: Number(id), action: "sent_back_for_changes",
        after: { note } });
    });
    return NextResponse.json({ ok: true, status: "appraised" });
  }

  if (action === "disburse") {
    // №2 (owner, 29 Aug 2026): the creator never disburses their own file —
    // this extends maker≠checker beyond the approver (E11's DB trigger).
    if (Number(app.created_by) === Number(actor.employeeId))
      return NextResponse.json({ ok: false,
        reason: "You created this file — another person must disburse it" }, { status: 403 });
    if (!can(actor, "disburse", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not disburse" }, { status: 403 });
    // Maker ≠ checker (owner, 28 Aug 2026): the approver never disburses.
    const approvedByMe = await one(
      `SELECT 1 FROM loan_state_history
        WHERE application_id = $1 AND to_state = 'approved' AND by_employee = $2 LIMIT 1`,
      [id, actor.employeeId]);
    if (approvedByMe)
      return NextResponse.json({ ok: false,
        reason: "You approved this loan — a different person must disburse it (maker ≠ checker)" },
        { status: 403 });
    if (app.status !== "approved")
      return NextResponse.json({ ok: false,
        reason: app.status === "pending_ho" ? "Still waiting for Head Office approval" : `Application is ${app.status}` },
        { status: 409 });

    const principal = Number(app.requested_paise);
    // №15 (owner finding, 20 Aug 2026): GST reads from the charge master's
    // Processing row — 18 survives only as the fallback when no row exists.
    const ct = await one(
      `SELECT id, gst_pct FROM charge_type WHERE name='Processing' AND active LIMIT 1`);
    const charge = docCharge({ principalPaise: principal, pct: Number(app.doc_charge_pct || 0),
      minPaise: Number(app.doc_charge_min_paise || 0), maxPaise: Number(app.doc_charge_max_paise || 0),
      gstPct: ct ? Number(ct.gst_pct) : 18 });

    // verify every named account really belongs to this customer and is verified
    const legs = [];
    for (const l of body.bankLegs || []) {
      const acc = await one(
        `SELECT id, verified_at, cheque_file_id FROM customer_bank_account WHERE id=$1 AND customer_id=$2`,
        [l.accountId, app.customer_id]);
      if (!acc) return NextResponse.json({ ok: false, reason: "That bank account is not on this customer's file" }, { status: 400 });
      legs.push({ accountId: acc.id, amountPaise: Number(l.amountPaise),
        verified: !!(acc.verified_at || acc.cheque_file_id) });
    }
    // R-D2 — the customer receives the full sanctioned amount; the charge is
    // raised on the loan below and collected at the first repayment.
    const plan = disbursementPlan({ principalPaise: principal,
      cashPaise: Number(body.cashPaise || 0), bankLegs: legs });
    if (!plan.ok) return NextResponse.json({ ok: false, reason: plan.problems[0], problems: plan.problems }, { status: 400 });

    const out = await tx(async (cl) => {
      const loanNo = await issueNumber(cl, { entityId: app.entity_id, branchId: app.branch_id,
        docType: "loan", fy: fy() });
      const { rows: [loan] } = await cl.query(
        `INSERT INTO loan (loan_no, application_id, entity_id, branch_id, customer_id, scheme_version_id,
           principal_paise, disbursed_at, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,'active',$8) RETURNING id`,
        [loanNo, id, app.entity_id, app.branch_id, app.customer_id, app.scheme_version_id,
         principal, actor.employeeId]);

      // The packet exists from the moment the gold is taken in — unsealed, at the
      // counter. Sealing happens at vault-in the next working day (R-V1).
      const packetNo = await issueNumber(cl, { entityId: app.entity_id, branchId: app.branch_id,
        docType: "packet", fy: fy() });
      await cl.query(`INSERT INTO packet (packet_no, loan_id, status) VALUES ($1,$2,'at_counter')`,
        [packetNo, loan.id]);

      const { rows: [d] } = await cl.query(
        `INSERT INTO disbursement (loan_id, from_slf_account_id, created_by) VALUES ($1,$2,$3) RETURNING id`,
        [loan.id, body.slfAccountId || null, actor.employeeId]);
      if (Number(body.cashPaise) > 0)
        await cl.query(`INSERT INTO disbursement_leg (disbursement_id, kind, amount_paise) VALUES ($1,'cash',$2)`,
          [d.id, Number(body.cashPaise)]);
      for (const l of legs)
        await cl.query(`INSERT INTO disbursement_leg (disbursement_id, kind, customer_bank_account_id, amount_paise, utr)
                        VALUES ($1,'bank',$2,$3,$4)`,
          [d.id, l.accountId, l.amountPaise, body.utr || null]);

      if (charge.totalPaise > 0) {
        // ct already fetched above — same row prices and ledgers the charge
        if (ct) await cl.query(
          `INSERT INTO loan_charge (loan_id, charge_type_id, base_paise, gst_paise, total_paise, floor_paise, narration, added_by)
           VALUES ($1,$2,$3,$4,$5,$5,'Processing charge — recovered at first repayment',$6)`,
          [loan.id, ct.id, charge.basePaise, charge.gstPaise, charge.totalPaise, actor.employeeId]);
      }

      await cl.query(`UPDATE loan_application SET status='activated', updated_at=now(), updated_by=$2 WHERE id=$1`,
        [id, actor.employeeId]);
      await cl.query(`INSERT INTO loan_state_history (application_id, loan_id, from_state, to_state, by_employee, note)
                      VALUES ($1,$2,'approved','active',$3,$4)`,
        [id, loan.id, actor.employeeId, `disbursed ${loanNo}`]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "loan", entityId: Number(loan.id), action: "loan_activated",
        after: { loanNo, principal, cash: body.cashPaise, legs: legs.length } });
      return { loanId: Number(loan.id), loanNo, packetNo };
    }, { entityIds: actor.entityIds });

    return NextResponse.json({ ok: true, ...out, chargePaise: charge.totalPaise });
  }

  return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[application action] failed", e);
    return NextResponse.json({ ok: false,
      reason: "The action failed — " + (e.message || "unknown error") + " (nothing was saved)" }, { status: 500 });
  }
}
