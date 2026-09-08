import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q } from "@/lib/db.js";
import { resolveBranchScope, resolvePeriod } from "@/lib/reports.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Loan application history — a true register: one row per state change,
 * straight from loan_state_history (append-only), joined to the file's facts.
 */
export async function GET(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "reports", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view reports" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = resolveBranchScope(actor, sp.branch);
  if (!scope) return NextResponse.json({ ok: false, reason: "That branch is not allotted to you" }, { status: 403 });
  const { from, to } = await resolvePeriod(sp);

  try {
    const params = [scope.ids, from, to];
    let extra = "";
    if (sp.state) { params.push(sp.state); extra += ` AND h.to_state = $${params.length}`; }
    if (sp.q?.trim()) {
      params.push(`%${sp.q.trim()}%`);
      extra += ` AND (a.app_no ILIKE $${params.length} OR c.full_name ILIKE $${params.length}
                      OR c.cust_no ILIKE $${params.length} OR c.mobile ILIKE $${params.length})`;
    }
    const rows = await q(
      `SELECT a.app_no, a.created_at::date::text AS started_on, a.status AS current_status,
              a.requested_paise, b.code AS branch_code, b.name AS branch_name,
              c.cust_no, c.full_name AS customer, c.mobile,
              s.code AS scheme,
              h.from_state, h.to_state, h.at, h.note,
              e.full_name AS by_name, e.emp_code
         FROM loan_state_history h
         JOIN loan_application a ON a.id = h.application_id
         JOIN branch b ON b.id = a.branch_id
         JOIN customer c ON c.id = a.customer_id
         LEFT JOIN scheme_version sv ON sv.id = a.scheme_version_id
         LEFT JOIN scheme s ON s.id = sv.scheme_id
         LEFT JOIN employee e ON e.id = h.by_employee
        WHERE a.branch_id = ANY($1::bigint[])
          AND h.at::date BETWEEN $2 AND $3 ${extra}
        ORDER BY h.at, h.id
        LIMIT 5000`, params);

    return NextResponse.json({ ok: true, from, to, scope: scope.label,
      rows: rows.map(r => ({ appNo: r.app_no, startedOn: r.started_on,
        currentStatus: r.current_status,
        requestedPaise: r.requested_paise == null ? null : Number(r.requested_paise),
        branch: `${r.branch_code} ${r.branch_name}`,
        custNo: r.cust_no, customer: r.customer, mobile: r.mobile, scheme: r.scheme,
        fromState: r.from_state, toState: r.to_state,
        at: r.at, by: r.by_name ? `${r.by_name} (${r.emp_code || "—"})` : "—",
        note: r.note })) });
  } catch (e) {
    console.error("[reports/apphistory] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the report" }, { status: 500 });
  }
}
