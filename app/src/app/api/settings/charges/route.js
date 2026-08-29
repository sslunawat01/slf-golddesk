import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validCharge } from "@/lib/masters.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "set_charges", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const rows = await q(
    `SELECT ct.id, ct.name, ct.calc, ct.amount_paise, ct.pct, ct.min_paise, ct.max_paise,
            ct.gst_pct, ct.is_penal, ct.active,
            (SELECT count(*) FROM loan_charge lc WHERE lc.charge_type_id = ct.id)::int AS used_on
       FROM charge_type ct ORDER BY ct.active DESC, ct.name`);
  return NextResponse.json({ ok: true, rows,
    canEdit: can(actor, "set_charges", { need: "add" }).ok || can(actor, "set_charges", { need: "edit" }).ok,
    verbs: { add: can(actor, "set_charges", { need: "add" }).ok,
             edit: can(actor, "set_charges", { need: "edit" }).ok,
             del: can(actor, "set_charges", { need: "delete" }).ok } });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "view");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

    const b = await req.json().catch(() => ({}));
    const v = validCharge(b);
    if (!v.ok) return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems }, { status: 400 });

    const name = String(b.name).trim();

    // —————————— edit / deactivate an existing charge ——————————
    if (b.id) {
      if (!can(actor, "set_charges", { need: "edit" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not change this — Edit permission needed" }, { status: 403 });
      const cur = await one(`SELECT * FROM charge_type WHERE id=$1`, [b.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Charge not found" }, { status: 404 });
      const dup = await one(`SELECT id FROM charge_type WHERE lower(name)=lower($1) AND id<>$2`, [name, b.id]);
      if (dup) return NextResponse.json({ ok: false, reason: "Another charge already has that name" }, { status: 409 });

      await tx(async (cl) => {
        await cl.query(
          `UPDATE charge_type SET name=$2, calc=$3::charge_calc, amount_paise=$4, pct=$5,
             min_paise=$6, max_paise=$7, gst_pct=$8, active=$9, updated_by=$10
           WHERE id=$1`,
          [b.id, name, b.calc,
           b.calc === "flat" ? Math.round(Number(b.amountRs) * 100) : null,
           b.calc === "pct_of_sanction" ? Number(b.pct) : null,
           b.minRs ? Math.round(Number(b.minRs) * 100) : null,
           b.maxRs ? Math.round(Number(b.maxRs) * 100) : null,
           Number(b.gstPct ?? 0), b.active !== false, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "charge_type", entityId: Number(b.id), action: "charge_type_updated",
          before: { name: cur.name, calc: cur.calc, active: cur.active },
          after: { name, calc: b.calc, active: b.active !== false } });
      }, { entityIds: "ALL" });
      return NextResponse.json({ ok: true, id: Number(b.id) });
    }

    // —————————— create ——————————
    if (!can(actor, "set_charges", { need: "add" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not create here — Add permission needed" }, { status: 403 });
    const dup = await one(`SELECT id FROM charge_type WHERE lower(name)=lower($1)`, [name]);
    if (dup) return NextResponse.json({ ok: false, reason: "A charge with that name already exists" }, { status: 409 });

    const out = await tx(async (cl) => {
      const { rows: [r] } = await cl.query(
        `INSERT INTO charge_type (name, calc, amount_paise, pct, min_paise, max_paise,
           gst_pct, is_penal, active, created_by)
         VALUES ($1,$2::charge_calc,$3,$4,$5,$6,$7,false,true,$8) RETURNING id`,
        [name, b.calc,
         b.calc === "flat" ? Math.round(Number(b.amountRs) * 100) : null,
         b.calc === "pct_of_sanction" ? Number(b.pct) : null,
         b.minRs ? Math.round(Number(b.minRs) * 100) : null,
         b.maxRs ? Math.round(Number(b.maxRs) * 100) : null,
         Number(b.gstPct ?? 0), actor.employeeId]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "charge_type", entityId: Number(r.id), action: "charge_type_created",
        after: { name, calc: b.calc } });
      return { id: Number(r.id) };
    }, { entityIds: "ALL" });

    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    console.error("[settings/charges] failed", e);
    return NextResponse.json({ ok: false,
      reason: "Save failed — " + (e.message || "unknown error") }, { status: 500 });
  }
}
