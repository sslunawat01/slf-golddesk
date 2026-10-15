import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { resolveBranchScope } from "@/lib/reports.js";
import { validFollowUp, presetRange } from "@/lib/followups.js";
import { worklist } from "@/lib/followups-db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET — the Follow-ups tab's worklist (E33).
 *   preset=missed|today|tomorrow|week  or  from=&to=   · branch=all|<id>
 *   assigned=me|none|<employeeId> · type= · channel= · q=
 * Needs the Collect desk (view). Branches are walled to the actor's postings.
 */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "collect", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view follow-ups" }, { status: 403 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = resolveBranchScope(actor, sp.branch || String(actor.actingBranchId));
  if (!scope) return NextResponse.json({ ok: false, reason: "No branches allotted" }, { status: 403 });
  const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
  let { from, to } = presetRange(sp.preset || "today", today);
  if (ISO.test(sp.from || "")) from = sp.from;
  if (ISO.test(sp.to || "")) to = sp.to;
  if (to < from) [from, to] = [to, from];
  try {
    const w = await worklist({ branchIds: scope.ids, from, to, today, employeeId: actor.employeeId,
      assignedTo: sp.assigned || null, type: sp.type || null, channel: sp.channel || null,
      text: (sp.q || "").trim() || null, withSuggestions: sp.suggestions !== "0" });
    const staff = await q(`SELECT DISTINCT e.id, e.full_name FROM employee e JOIN employee_branch eb ON eb.employee_id = e.id
                            WHERE e.status='active' AND eb.branch_id = ANY($1::bigint[]) AND eb.effective_to IS NULL ORDER BY e.full_name`, [scope.ids]);
    return NextResponse.json({ ok: true, today, from, to, scope: scope.label, ...w,
      staff: staff.map(s => ({ id: Number(s.id), name: s.full_name })),
      me: Number(actor.employeeId), canLog: can(actor, "collect", { need: "full" }).ok });
  } catch (e) {
    console.error("[followups] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the follow-up list" }, { status: 500 });
  }
}

/** POST — log a follow-up on a loan (append-only). Needs Collect (full). */
export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "collect", { need: "full" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not record follow-ups" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const loan = b.loanId ? await one(`SELECT id, loan_no, branch_id, status FROM loan WHERE id=$1`, [Number(b.loanId)]) : null;
  if (!loan) return NextResponse.json({ ok: false, reason: "Loan not found" }, { status: 404 });
  if (!(actor.branchIds || []).includes(Number(loan.branch_id)))
    return NextResponse.json({ ok: false, reason: "That loan belongs to a branch you are not posted to" }, { status: 403 });
  if (loan.status !== "active")
    return NextResponse.json({ ok: false, reason: `The loan is ${loan.status} — follow-ups are for running loans` }, { status: 409 });
  const outcomes = (await one(`SELECT enum_range(NULL::call_outcome)::text[] AS labels`)).labels;
  const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
  const v = validFollowUp(b, outcomes, today);
  if (!v.ok) return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems }, { status: 400 });
  if (v.assignedTo) {
    const ok = await one(`SELECT 1 FROM employee_branch WHERE employee_id=$1 AND branch_id=$2 AND effective_to IS NULL`, [v.assignedTo, loan.branch_id]);
    if (!ok) return NextResponse.json({ ok: false, reason: "The assignee is not posted to this loan's branch" }, { status: 400 });
  }
  try {
    const out = await tx(async (cl) => {
      const { rows: [r] } = await cl.query(
        `INSERT INTO collection_call (loan_id, method, outcome, ptp_date, next_follow_up, note, by_employee,
           fu_type, channel, ptp_amount_paise, next_type, assigned_to)
         VALUES ($1,$2,$3::call_outcome,$4,$5,$6,$7,$8::followup_type,$9::followup_channel,$10,$11::followup_type,$12) RETURNING id`,
        [loan.id, v.channel, v.outcome, v.ptpDate, v.nextFollowUp, v.remark, actor.employeeId,
         v.type, v.channel, v.ptpAmountPaise, v.nextFollowUp ? v.nextType : null, v.nextFollowUp ? v.assignedTo : null]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "collection_call", entityId: Number(r.id), action: "follow_up",
        after: { loanNo: loan.loan_no, type: v.type, channel: v.channel, outcome: v.outcome,
          ptp: v.ptpDate, ptpAmountPaise: v.ptpAmountPaise, next: v.nextFollowUp, nextType: v.nextType, assignedTo: v.assignedTo } });
      return { id: Number(r.id) };
    }, { entityIds: actor.entityIds });
    return NextResponse.json({ ok: true, ...out, next: v.nextFollowUp });
  } catch (e) {
    console.error("[followups POST] failed", e);
    return NextResponse.json({ ok: false, reason: "The follow-up could not be saved — " + (e.message || "") }, { status: 500 });
  }
}
