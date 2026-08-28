import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validPurity, addableMetalKinds } from "@/lib/metals.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "set_metals", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

// ————————————————————————— GET —————————————————————————

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const metals = await q(
    `SELECT id, kind::text, enabled, valued_as_pct_of_gold FROM metal ORDER BY id`);
  const purities = await q(
    `SELECT p.id, p.metal_id, p.karat, p.purity_pct, p.active,
            (SELECT count(*) FROM appraisal_item ai WHERE ai.purity_id = p.id)::int AS used_on
       FROM purity p
      WHERE p.effective_to IS NULL OR p.effective_to >= CURRENT_DATE
      ORDER BY p.metal_id, p.purity_pct DESC`);
  const rates = await q(
    `SELECT DISTINCT ON (metal_id) metal_id, base_paise, funding_paise, rate_date
       FROM daily_rate ORDER BY metal_id, rate_date DESC`);
  const enumKinds = (await one(`SELECT enum_range(NULL::metal_kind)::text[] AS kinds`)).kinds;

  return NextResponse.json({ ok: true,
    metals: metals.map(m => ({ id: Number(m.id), kind: m.kind, enabled: m.enabled,
      valuedAsPctOfGold: m.valued_as_pct_of_gold,
      rate: (() => {
        const r = rates.find(x => Number(x.metal_id) === Number(m.id));
        return r ? { basePaise: Number(r.base_paise), fundingPaise: Number(r.funding_paise),
                     date: r.rate_date } : null;
      })() })),
    purities: purities.map(p => ({ id: Number(p.id), metalId: Number(p.metal_id),
      karat: p.karat, pct: Number(p.purity_pct), active: p.active, usedOn: p.used_on })),
    addableKinds: addableMetalKinds(enumKinds, metals.map(m => m.kind)),
    canEdit: can(actor, "set_metals", { need: "add" }).ok || can(actor, "set_metals", { need: "edit" }).ok,
    verbs: { add: can(actor, "set_metals", { need: "add" }).ok,
             edit: can(actor, "set_metals", { need: "edit" }).ok,
             del: can(actor, "set_metals", { need: "delete" }).ok } });
}

// ————————————————————————— POST —————————————————————————

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "view");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });
    const b = await req.json().catch(() => ({}));

    // ——— add a purity grade ———
    if (b.action === "add_purity") {
      if (!can(actor, "set_metals", { need: "add" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not create here — ask for the Add permission on Settings · metals" }, { status: 403 });
      const metal = await one(`SELECT id, kind::text, valued_as_pct_of_gold FROM metal WHERE id=$1`,
        [b.metalId]);
      if (!metal) return bad(["Pick the metal this grade belongs to"]);
      const v = validPurity(b, { valuedAsPctOfGold: metal.valued_as_pct_of_gold });
      if (!v.ok) return bad(v.problems);
      const dup = await one(
        `SELECT id FROM purity WHERE metal_id=$1 AND lower(karat)=lower($2)
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)`, [v.metalId, v.karat]);
      if (dup) return bad([`${metal.kind} already has a grade called ${v.karat}`], 409);
      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO purity (metal_id, karat, purity_pct, created_by)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [v.metalId, v.karat, v.pct, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "purity", entityId: r.rows[0].id, action: "create",
          after: { metal: metal.kind, karat: v.karat, pct: v.pct } });
        return r.rows[0];
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    // ——— edit a purity: VERSIONED, never in place (unless born today) ———
    if (b.action === "edit_purity") {
      if (!can(actor, "set_metals", { need: "edit" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not change this — ask for the Edit permission on Settings · metals" }, { status: 403 });
      const cur = await one(
        `SELECT p.*, m.kind::text AS metal_kind, m.valued_as_pct_of_gold
           FROM purity p JOIN metal m ON m.id = p.metal_id WHERE p.id=$1`, [b.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Grade not found" }, { status: 404 });
      const v = validPurity({ ...b, metalId: cur.metal_id },
        { valuedAsPctOfGold: cur.valued_as_pct_of_gold });
      if (!v.ok) return bad(v.problems);

      const row = await tx(async (cl) => {
        if (String(cur.effective_from) === new Date().toISOString().slice(0, 10)) {
          // born today — correct it in place, no version noise
          await cl.query(`UPDATE purity SET karat=$2, purity_pct=$3 WHERE id=$1`,
            [cur.id, v.karat, v.pct]);
          await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
            table: "purity", entityId: cur.id, action: "correct_same_day",
            before: { karat: cur.karat, pct: Number(cur.purity_pct) },
            after: { karat: v.karat, pct: v.pct } });
          return { id: cur.id };
        }
        // end-date the old truth, start a new one today
        await cl.query(
          `UPDATE purity SET effective_to = CURRENT_DATE - 1, active = FALSE WHERE id=$1`,
          [cur.id]);
        const r = await cl.query(
          `INSERT INTO purity (metal_id, karat, purity_pct, created_by)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [cur.metal_id, v.karat, v.pct, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "purity", entityId: r.rows[0].id, action: "revise",
          before: { karat: cur.karat, pct: Number(cur.purity_pct), oldId: Number(cur.id) },
          after: { karat: v.karat, pct: v.pct } });
        return r.rows[0];
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    // ——— lending toggle on a grade ———
    if (b.action === "toggle_purity") {
      if (!can(actor, "set_metals", { need: "edit" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not change this — ask for the Edit permission on Settings · metals" }, { status: 403 });
      const cur = await one(`SELECT id, karat, active FROM purity WHERE id=$1`, [b.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Grade not found" }, { status: 404 });
      await tx(async (cl) => {
        await cl.query(`UPDATE purity SET active = NOT active WHERE id=$1`, [cur.id]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "purity", entityId: cur.id,
          action: cur.active ? "disable" : "enable", before: { karat: cur.karat } });
      });
      return NextResponse.json({ ok: true });
    }

    // ——— add a metal (only kinds the database enum already knows) ———
    if (b.action === "add_metal") {
      if (!can(actor, "set_metals", { need: "add" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not create here — ask for the Add permission on Settings · metals" }, { status: 403 });
      const enumKinds = (await one(`SELECT enum_range(NULL::metal_kind)::text[] AS kinds`)).kinds;
      const existing = await q(`SELECT kind::text FROM metal`);
      const addable = addableMetalKinds(enumKinds, existing.map(x => x.kind));
      if (!addable.includes(b.kind))
        return bad(["That metal kind is not available — a brand-new kind is a database change, not a settings click"]);
      const row = await tx(async (cl) => {
        const r = await cl.query(
          `INSERT INTO metal (kind, valued_as_pct_of_gold) VALUES ($1::metal_kind, $2) RETURNING id`,
          [b.kind, !!b.valuedAsPctOfGold]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "metal", entityId: r.rows[0].id, action: "create",
          after: { kind: b.kind, valuedAsPctOfGold: !!b.valuedAsPctOfGold } });
        return r.rows[0];
      });
      return NextResponse.json({ ok: true, id: Number(row.id) });
    }

    // ——— link / unlink a metal from the gold rate ———
    if (b.action === "toggle_pct_of_gold") {
      if (!can(actor, "set_metals", { need: "edit" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not change this — ask for the Edit permission on Settings · metals" }, { status: 403 });
      const cur = await one(
        `SELECT id, kind::text, valued_as_pct_of_gold FROM metal WHERE id=$1`, [b.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Metal not found" }, { status: 404 });
      if (cur.kind === "gold")
        return NextResponse.json({ ok: false,
          reason: "Gold is the anchor — it cannot be linked to itself" }, { status: 409 });
      await tx(async (cl) => {
        await cl.query(`UPDATE metal SET valued_as_pct_of_gold = NOT valued_as_pct_of_gold
          WHERE id=$1`, [cur.id]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "metal", entityId: cur.id,
          action: cur.valued_as_pct_of_gold ? "unlink_from_gold" : "link_to_gold",
          before: { kind: cur.kind } });
      });
      return NextResponse.json({ ok: true });
    }

    // ——— enable / disable a metal ———
    if (b.action === "toggle_metal") {
      if (!can(actor, "set_metals", { need: "edit" }).ok)
        return NextResponse.json({ ok: false, reason: "You may not change this — ask for the Edit permission on Settings · metals" }, { status: 403 });
      const cur = await one(`SELECT id, kind::text, enabled FROM metal WHERE id=$1`, [b.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Metal not found" }, { status: 404 });
      await tx(async (cl) => {
        await cl.query(`UPDATE metal SET enabled = NOT enabled WHERE id=$1`, [cur.id]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "metal", entityId: cur.id,
          action: cur.enabled ? "disable" : "enable", before: { kind: cur.kind } });
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (String(e.message || "").includes("purity_metal_id_karat_effective_from_key"))
      return NextResponse.json({ ok: false,
        reason: "That grade was already revised today — refresh and edit the new row" }, { status: 409 });
    return NextResponse.json({ ok: false, reason: "The change could not be saved" }, { status: 500 });
  }
}

function bad(problems, status = 400) {
  return NextResponse.json({ ok: false, reason: problems[0], problems }, { status });
}
