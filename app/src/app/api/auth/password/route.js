import { NextResponse } from "next/server";
import { currentActor, setPassword } from "@/lib/session.js";
import { checkPasswordPolicy } from "@/lib/password.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  const { password } = await req.json().catch(() => ({}));
  const pol = checkPasswordPolicy(password, actor.username);
  if (!pol.ok) return NextResponse.json({ ok: false, reason: "Password does not meet the requirements" }, { status: 400 });
  await setPassword(actor.employeeId, password);
  return NextResponse.json({ ok: true });
}
