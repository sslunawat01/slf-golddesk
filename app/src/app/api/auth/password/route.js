import { NextResponse } from "next/server";
import { currentActor, setPassword } from "@/lib/session.js";
import { checkPasswordPolicy, verifyPassword } from "@/lib/password.js";
import { one, tx, audit } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Set / change the signed-in user's password.
 *  · forced change (temporary password): no current password needed
 *  · voluntary change (E35, owner 15 Oct 2026): the CURRENT password must be given and
 *    must verify; the new one must differ from it. Every open session ends either way.
 */
export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  const { password, current } = await req.json().catch(() => ({}));
  const pol = checkPasswordPolicy(password, actor.username);
  if (!pol.ok)
    return NextResponse.json({ ok: false, reason: "Password needs: " + pol.checks.filter(c => !c.pass).map(c => c.label).join(", ") }, { status: 400 });
  if (!actor.forceChange) {
    if (!current) return NextResponse.json({ ok: false, reason: "Type your current password first" }, { status: 400 });
    const row = await one(`SELECT password_hash FROM employee WHERE id=$1`, [actor.employeeId]);
    if (!row || !verifyPassword(current, row.password_hash))
      return NextResponse.json({ ok: false, reason: "The current password is not correct" }, { status: 400 });
    if (current === password)
      return NextResponse.json({ ok: false, reason: "The new password must differ from the current one" }, { status: 400 });
  }
  await setPassword(actor.employeeId, password);
  await tx(async (cl) => {
    await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
      table: "employee", entityId: actor.employeeId, action: actor.forceChange ? "password_set" : "password_changed" });
  }, { entityIds: actor.entityIds });
  return NextResponse.json({ ok: true });
}
