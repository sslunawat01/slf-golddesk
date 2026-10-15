import { NextResponse } from "next/server";
import { createSession, loadActor, clientMeta, currentActor, COOKIE } from "@/lib/session.js";
import { readLoginTicket } from "@/lib/loginticket.js";
import { q } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Choose / switch the acting branch.
 *
 * E28 (14 Oct 2026) — SECURITY: this route used to trust `employeeId` from
 * the request body and mint a session with no password and no cookie. It
 * now accepts exactly two proofs of identity, and NEVER the body's id:
 *   · switching from the header → the caller's live session (currentActor)
 *   · the login branch picker   → the 5-minute ticket /api/auth/login issued
 *     after the password check (src/lib/loginticket.js)
 */
export async function POST(req) {
  const { branchId, keep, ticket } = await req.json().catch(() => ({}));

  let employeeId = null, oldSessionId = null, keepIt = !!keep;
  const live = await currentActor();
  if (live) {
    employeeId = live.employeeId;
    oldSessionId = live.sessionId;
    keepIt = true;                       // a switch keeps the user's "stay signed in" choice
  } else {
    employeeId = readLoginTicket(ticket);
    if (!employeeId)
      return NextResponse.json({ ok: false,
        reason: "Your sign-in has timed out — enter your password again" }, { status: 401 });
  }

  const actor = await loadActor(employeeId, branchId);
  if (!actor || !actor.branchIds.includes(Number(branchId)))
    return NextResponse.json({ ok: false, reason: "Not posted to that branch" }, { status: 403 });

  const meta = await clientMeta();
  const { token, expires } = await createSession(employeeId, Number(branchId), { ...meta, keep: keepIt });
  // a switch replaces the old session — it must not stay usable alongside the new one
  if (oldSessionId) await q(`UPDATE session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [oldSessionId]);
  await q(`INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
           VALUES ($1,$2,'session',$1,$3,$4)`,
    [employeeId, Number(branchId), live ? "branch_switched" : "login_branch_chosen",
     JSON.stringify({ branchId: Number(branchId) })]);
  const res = NextResponse.json({ ok: true, next: actor.forceChange ? "password" : "home" });
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: true, path: "/", expires });
  return res;
}
