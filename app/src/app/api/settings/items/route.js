import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validItem } from "@/lib/metals.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "settings", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const items = await q(
    `SELECT i.id, i.name, i.print_name, i.metal_id, i.description, i.active,
            m.kind::text AS metal,
            (SELECT count(*) FROM appraisal_item ai WHERE ai.item_id = i.id)::int AS used_on
       FROM item i JOIN metal m ON m.id = i.metal_id
      ORDER BY i.active DESC, m.id, i.name`);
  const metals = await q(`SELECT id, kind::text FROM metal ORDER BY id`);

  return NextResponse.json({ ok: true,
    rows: items.map(i => ({ id: Number(i.id), name: i.name, printName: i.print_name,
      metalId: Number(i.metal_id), metal: i.metal, description: i.description,
      active: i.active, usedOn: i.used_on })),
    metals: metals.map(m => ({ id: Number(m.id), kind: m.kind })),
    canEdit: can(actor, "settings", { need: "full" }).ok });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "full");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });
    const b = await req.json().catch(() => ({}));

    if (b.action === "create") {
      const v = validItem(b);
      if (!v.ok) return bad(v.problems);
      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO item (name, print_name, metal_id, description, created_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [v.name, v.printName, v.metalId, v.description, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "item", entityId: r.rows[0].id, action: "create",
          after: { name: v.name, printName: v.printName } });
        return r.rows[0];
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    const item = b.id ? await one(`SELECT * FROM item WHERE id=$1`, [b.id]) : null;
    if (!item) return NextResponse.json({ ok: false, reason: "Item not found" }, { status: 404 });

    if (b.action === "edit") {
      const v = validItem(b);
      if (!v.ok) return bad(v.problems);
      await tx(async (cl) => {
        await cl.query(
          `UPDATE item SET name=$2, print_name=$3, metal_id=$4, description=$5, updated_by=$6
            WHERE id=$1`,
          [item.id, v.name, v.printName, v.metalId, v.description, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "item", entityId: item.id, action: "edit",
          before: { name: item.name }, after: { name: v.name, printName: v.printName } });
      });
      return NextResponse.json({ ok: true });
    }

    if (b.action === "toggle") {
      await tx(async (cl) => {
        await cl.query(`UPDATE item SET active = NOT active, updated_by=$2 WHERE id=$1`,
          [item.id, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "item", entityId: item.id,
          action: item.active ? "deactivate" : "reactivate", before: { name: item.name } });
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (String(e.message || "").includes("item_name_metal_id_key"))
      return NextResponse.json({ ok: false,
        reason: "That metal already has an item with that name" }, { status: 409 });
    return NextResponse.json({ ok: false, reason: "The change could not be saved" }, { status: 500 });
  }
}

function bad(problems, status = 400) {
  return NextResponse.json({ ok: false, reason: problems[0], problems }, { status });
}
