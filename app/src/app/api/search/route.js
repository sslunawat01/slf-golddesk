import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { q } from "@/lib/db.js";
import { kycStatus } from "@/lib/customer.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Search is the front door: loan numbers first, then customers. */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  const term = (new URL(req.url).searchParams.get("q") || "").trim();
  if (term.length < 2) return NextResponse.json({ ok: true, loans: [], customers: [] });

  const today = new Date().toISOString().slice(0, 10);
  const like = `%${term}%`;

  const loans = await q(
    `SELECT l.id, l.loan_no AS "loanNo", l.principal_paise AS "principalPaise", l.disbursed_at AS "disbursedAt",
            c.id AS "customerId", c.full_name AS "customerName", s.code AS scheme, b.code AS "branchCode"
       FROM loan l JOIN customer c ON c.id = l.customer_id
       JOIN scheme_version sv ON sv.id = l.scheme_version_id JOIN scheme s ON s.id = sv.scheme_id
       JOIN branch b ON b.id = l.branch_id
      WHERE l.status = 'active' AND l.loan_no ILIKE $1
      ORDER BY (l.loan_no ILIKE $2) DESC, l.loan_no LIMIT 10`, [like, term]);

  const customers = await q(
    `SELECT c.id, c.cust_no AS "custNo", c.full_name AS "fullName", c.mobile,
            c.kyc_done_at AS "kycDoneAt", c.is_blacklisted AS "isBlacklisted",
            (SELECT count(*) FROM loan WHERE customer_id = c.id AND status = 'active')::int AS "openLoans",
            COALESCE((SELECT sum(principal_paise) FROM loan WHERE customer_id = c.id AND status = 'active'),0)::bigint AS "outPaise"
       FROM customer c
      WHERE c.mobile ILIKE $1 OR c.cust_no ILIKE $1 OR c.full_name ILIKE $1
      ORDER BY (c.mobile = $2) DESC, (c.cust_no ILIKE $2) DESC, c.full_name LIMIT 12`, [like, term]);

  return NextResponse.json({
    ok: true,
    loans: loans.map(l => ({ ...l, id: Number(l.id), customerId: Number(l.customerId) })),
    customers: customers.map(c => ({ ...c, id: Number(c.id), kyc: kycStatus(c.kycDoneAt, today) })),
  });
}
