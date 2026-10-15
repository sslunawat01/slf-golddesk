import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can, needsHoApproval } from "@/lib/policy.js";
import { one, tx, audit } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Head Office decides an above-limit pledge. The recommender can never decide it. */
export async function POST(req, { params }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "sanction", { need: "full" }).ok || !can(actor, "settings", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not decide approvals" }, { status: 403 });

  const { id } = await params;
  const { decision, reason } = await req.json().catch(() => ({}));
  // E28: anything but approve/reject used to fall through as a REJECTION and
  // then crash on reason.trim() — refuse it plainly instead
  if (!["approve", "reject"].includes(decision))
    return NextResponse.json({ ok: false, reason: "Choose approve or reject" }, { status: 400 });
  const a = await one(`SELECT * FROM ho_approval WHERE id=$1`, [id]);
  if (!a) return NextResponse.json({ ok: false, reason: "Not found" }, { status: 404 });
  if (a.status !== "waiting") return NextResponse.json({ ok: false, reason: `Already ${a.status}` }, { status: 409 });
  if (Number(a.recommended_by) === Number(actor.employeeId))
    return NextResponse.json({ ok: false, reason: "You recommended this file — someone else must decide it" }, { status: 403 });

  if (decision === "approve" && needsHoApproval(actor, Number(a.amount_paise)))
    return NextResponse.json({ ok: false, reason: "This amount is above your own sanction authority too" }, { status: 403 });
  if (decision === "reject" && (!reason || reason.trim().length < 5))
    return NextResponse.json({ ok: false, reason: "Give a reason of at least 5 characters" }, { status: 400 });

  // E28 (14 Oct 2026): both updates are now GUARDED. Before, an approval
  // raced against (or landed after) a branch cancel/withdraw/day-end would
  // flip a CANCELLED file back to approved. Both rows must still be in the
  // state this decision assumes, or nothing is written.
  const stale = new Error("stale");
  try {
  await tx(async (cl) => {
    const h = await cl.query(`UPDATE ho_approval SET status=$2, decided_by=$3, decided_at=now(), reject_reason=$4
                               WHERE id=$1 AND status='waiting'`,
      [id, decision === "approve" ? "approved" : "rejected", actor.employeeId,
       decision === "approve" ? null : reason.trim()]);
    const ap = await cl.query(`UPDATE loan_application SET status=$2, updated_at=now(), updated_by=$3
                                WHERE id=$1 AND status='pending_ho'`,
      [a.application_id, decision === "approve" ? "approved" : "appraised", actor.employeeId]);
    if (h.rowCount !== 1 || ap.rowCount !== 1) throw stale;
    await cl.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
                    VALUES ($1,'pending_ho',$2,$3,$4)`,
      [a.application_id, decision === "approve" ? "approved" : "appraised", actor.employeeId,
       decision === "approve" ? "approved by head office" : `rejected: ${reason}`]);
    await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
      table: "ho_approval", entityId: Number(id), action: "ho_" + decision,
      after: { amount: Number(a.amount_paise), reason: reason || null } });
  }, { entityIds: "ALL" });
  } catch (e) {
    if (e === stale) return NextResponse.json({ ok: false,
      reason: "This file is no longer waiting for Head Office — it was cancelled, withdrawn or already decided. Refresh the list." },
      { status: 409 });
    throw e;
  }

  return NextResponse.json({ ok: true });
}
