import { NextResponse } from "next/server";
import { createSession, loadActor, clientMeta, COOKIE } from "@/lib/session.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { employeeId, branchId, keep } = await req.json().catch(() => ({}));
  const actor = await loadActor(employeeId, branchId);
  if (!actor || !actor.branchIds.includes(Number(branchId)))
    return NextResponse.json({ ok: false, reason: "Not posted to that branch" }, { status: 403 });
  const meta = await clientMeta();
  const { token, expires } = await createSession(employeeId, branchId, { ...meta, keep: !!keep });
  const res = NextResponse.json({ ok: true, next: actor.forceChange ? "password" : "home" });
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: true, path: "/", expires });
  return res;
}
