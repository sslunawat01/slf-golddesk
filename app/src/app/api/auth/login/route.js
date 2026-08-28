import { NextResponse } from "next/server";
import { authenticate, createSession, clientMeta, COOKIE } from "@/lib/session.js";
import { q, one } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { username, password, keep } = await req.json().catch(() => ({}));
  const r = await authenticate(username, password);
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason }, { status: 401 });

  // more than one branch ⇒ resume the LAST branch this person worked at
  // (owner №2, 28 Aug 2026). The header's branch switcher covers changing it.
  // First-ever login (no session history) still asks.
  if (r.branches.length > 1) {
    const last = await one(
      `SELECT acting_branch_id FROM session
        WHERE employee_id = $1 AND acting_branch_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`, [r.employeeId]);
    const lastId = last ? Number(last.acting_branch_id) : null;
    if (!lastId || !r.branches.some(b => Number(b.id) === lastId)) {
      const withDay = await withDayBegin(r.branches);
      return NextResponse.json({ ok: true, next: "branch", employeeId: r.employeeId, branches: withDay });
    }
    const meta0 = await clientMeta();
    const s0 = await createSession(r.employeeId, lastId, { ...meta0, keep: !!keep });
    const res0 = NextResponse.json({ ok: true, next: r.forceChange ? "password" : "home" });
    res0.cookies.set(COOKIE, s0.token, {
      httpOnly: true, sameSite: "lax", secure: true, path: "/", expires: s0.expires,
    });
    return res0;
  }

  if (r.branches.length === 0)
    return NextResponse.json({ ok: false,
      reason: "You are not posted to any branch yet — ask the administrator to post you, then sign in" },
      { status: 403 });
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
