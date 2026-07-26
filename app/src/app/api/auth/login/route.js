import { NextResponse } from "next/server";
import { authenticate, createSession, clientMeta, COOKIE } from "@/lib/session.js";
import { q } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { username, password, keep } = await req.json().catch(() => ({}));
  const r = await authenticate(username, password);
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 401 });

  // more than one branch ⇒ ask which one before issuing the session
  if (r.branches.length > 1) {
    const withDay = await withDayBegin(r.branches);
    return NextResponse.json({ ok: true, next: "branch", employeeId: r.employeeId, branches: withDay });
  }

  const branchId = r.branches[0]?.id ?? null;
  const meta = await clientMeta();
  const { token, expires } = await createSession(r.employeeId, branchId, { ...meta, keep: !!keep });
  const res = NextResponse.json({ ok: true, next: r.forceChange ? "password" : "home" });
  res.cookies.set(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/", expires,
  });
  return res;
}

async function withDayBegin(branches) {
  const rows = await q(
    `SELECT branch_id, begin_signed_at FROM day_cycle
      WHERE business_date = CURRENT_DATE AND branch_id = ANY($1::bigint[])`,
    [branches.map(b => b.id)]);
  const map = new Map(rows.map(r => [Number(r.branch_id), !!r.begin_signed_at]));
  return branches.map(b => ({ ...b, dayBegun: map.get(Number(b.id)) || false }));
}
