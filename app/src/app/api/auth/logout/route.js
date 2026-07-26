import { NextResponse } from "next/server";
import { revokeSession, COOKIE } from "@/lib/session.js";
export const runtime = "nodejs";
export async function POST() {
  await revokeSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
