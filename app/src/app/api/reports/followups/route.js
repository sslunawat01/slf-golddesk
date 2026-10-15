import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";
import { resolveBranchScope, resolvePeriod } from "@/lib/reports.js";
import { TYPES, CHANNELS } from "@/lib/followups.js";
import { register } from "@/lib/followups-db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Follow-up Register (E33) — due in the period, done in the period, promises
 * falling in the period (kept / broken from the receipts), and a per-staff tally.
 *   fy= · from= · to= · branch=all|<id> · type= · channel= · staff=<employeeId>
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
  const type = TYPES.some(([k]) => k === sp.type) ? sp.type : null;
  const channel = CHANNELS.some(([k]) => k === sp.channel) ? sp.channel : null;
  const staff = /^\d+$/.test(sp.staff || "") ? Number(sp.staff) : null;

  try {
    const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
    const r = await register({ branchIds: scope.ids, from, to, today, type, channel, staff });
    const staffRows = await q(`SELECT DISTINCT e.id, e.full_name FROM employee e JOIN employee_branch eb ON eb.employee_id = e.id
                                WHERE eb.branch_id = ANY($1::bigint[]) ORDER BY e.full_name`, [scope.ids]);
    return NextResponse.json({ ok: true, from, to, today, scope: scope.label, ...r,
      staff: staffRows.map(s => ({ id: Number(s.id), name: s.full_name })) });
  } catch (e) {
    console.error("[reports/followups] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not build the report" }, { status: 500 });
  }
}
