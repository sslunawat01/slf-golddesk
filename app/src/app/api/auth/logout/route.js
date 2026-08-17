import { NextResponse } from "next/server";
import { revokeSession, COOKIE } from "@/lib/session.js";
export const runtime = "nodejs";
export async function POST(req) {
  await revokeSession();
  const res = NextResponse.redirect(new URL("/login?out=1", req.url), 303);
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
