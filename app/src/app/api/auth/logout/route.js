import { NextResponse } from "next/server";
import { revokeSession, COOKIE } from "@/lib/session.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  await revokeSession();
  // The proxy sees itself as localhost:3000; the browser's real address lives
  // in the forwarded headers. Build the redirect from those, never from req.url.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "slf.slunawat.in";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const res = NextResponse.redirect(`${proto}://${host}/login?out=1`, 303);
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
