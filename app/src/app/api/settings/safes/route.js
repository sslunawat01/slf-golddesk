import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validSafe, canDeactivateSafe } from "@/lib/metals.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "settings", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

/** Packets currently inside each safe: the LAST movement per packet, kept if it is an IN. */
const OCCUPANCY = `
  SELECT lm.safe_id, count(*)::int AS inside
    FROM (SELECT DISTINCT ON (packet_id) packet_id, direction, safe_id
            FROM vault_movement ORDER BY packet_id, id DESC) lm
   WHERE lm.direction = 'in'
   GROUP BY lm.safe_id`;

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const safes = await q(
    `SELECT s.id, s.branch_id, s.label, s.location_note, s.active,
            COALESCE(o.inside, 0) AS inside
       FROM safe s LEFT JOIN (${OCCUPANCY}) o ON o.safe_id = s.id
      ORDER BY s.branch_id, s.label`);

  return NextResponse.json({ ok: true,
    rows: safes.map(s => ({ id: Number(s.id), branchId: Number(s.branch_id),
      label: s.label, locationNote: s.location_note, active: s.active,
      inside: Number(s.inside) })),
    canEdit: can(actor, "settings", { need: "full" }).ok });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "full");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });
    const b = await req.json().catch(() => ({}));

    if (b.action === "create") {
      const v = validSafe(b);
      if (!v.ok) return bad(v.problems);
      const br = await one(`SELECT id, code, name, is_ho FROM branch WHERE id=$1 AND active`,
        [v.branchId]);
      if (!br) return bad(["Branch not found"]);
      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO safe (branch_id, label, location_note, created_by)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [v.branchId, v.label, v.locationNote, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "safe", entityId: r.rows[0].id, action: "create",
          after: { branch: br.code, label: v.label } });
        return r.rows[0];
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    const safe = b.id ? await one(`SELECT * FROM safe WHERE id=$1`, [b.id]) : null;
    if (!safe) return NextResponse.json({ ok: false, reason: "Safe not found" }, { status: 404 });

    if (b.action === "rename") {
      const v = validSafe({ label: b.label, branchId: safe.branch_id,
        locationNote: b.locationNote ?? safe.location_note });
      if (!v.ok) return bad(v.problems);
      await tx(async (cl) => {
        await cl.query(`UPDATE safe SET label=$2, location_note=$3, updated_by=$4 WHERE id=$1`,
          [safe.id, v.label, v.locationNote, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "safe", entityId: safe.id, action: "rename",
          before: { label: safe.label }, after: { label: v.label } });
      });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "toggle") {
      if (safe.active) {
        const occ = await one(
          `SELECT COALESCE(inside, 0) AS inside FROM (${OCCUPANCY}) o WHERE o.safe_id=$1`,
          [safe.id]);
        const gate = canDeactivateSafe(occ ? occ.inside : 0);
        if (!gate.ok) return NextResponse.json({ ok: false, reason: gate.reason }, { status: 409 });
      }
      await tx(async (cl) => {
        await cl.query(`UPDATE safe SET active = NOT active, updated_by=$2 WHERE id=$1`,
          [safe.id, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "safe", entityId: safe.id,
          action: safe.active ? "deactivate" : "reactivate", before: { label: safe.label } });
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (String(e.message || "").includes("safe_branch_id_label_key"))
      return NextResponse.json({ ok: false,
        reason: "That branch already has a safe with that label" }, { status: 409 });
    return NextResponse.json({ ok: false, reason: "The change could not be saved" }, { status: 500 });
  }
}

function bad(problems, status = 400) {
  return NextResponse.json({ ok: false, reason: problems[0], problems }, { status });
}
