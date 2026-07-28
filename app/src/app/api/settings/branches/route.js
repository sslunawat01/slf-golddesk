import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validBranch } from "@/lib/masters.js";
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

  const entities = await q(
    `SELECT id, code, legal_name, series::text AS series, active FROM entity ORDER BY id`);
  const branches = await q(
    `SELECT b.id, b.entity_id, b.code, b.name, b.print_name, b.is_ho, b.phone,
            b.address_json, b.active,
            (SELECT count(*) FROM safe s WHERE s.branch_id=b.id AND s.active)::int AS safes,
            (SELECT count(*) FROM scheme_branch sb JOIN scheme_version sv ON sv.id=sb.scheme_version_id
              WHERE sb.branch_id=b.id AND sv.status='published')::int AS schemes,
            (SELECT count(*) FROM loan l WHERE l.branch_id=b.id AND l.status='active')::int AS active_loans
       FROM branch b ORDER BY b.id`);
  return NextResponse.json({ ok: true, entities, branches,
    canEdit: can(actor, "settings", { need: "full" }).ok });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "full");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

    const b = await req.json().catch(() => ({}));

    // —————————— edit ——————————
    // The code is never editable: it is printed into every loan number ever
    // issued at the branch, so changing it would orphan the whole book.
    if (b.id) {
      const cur = await one(`SELECT * FROM branch WHERE id=$1`, [b.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Branch not found" }, { status: 404 });
      const name = String(b.name || "").trim();
      if (name.length < 3)
        return NextResponse.json({ ok: false, reason: "Give the branch a name of at least 3 characters" }, { status: 400 });

      if (b.active === false) {
        const open = await one(
          `SELECT count(*)::int AS n FROM loan WHERE branch_id=$1 AND status='active'`, [b.id]);
        if (open.n > 0)
          return NextResponse.json({ ok: false,
            reason: `This branch still has ${open.n} active loan${open.n === 1 ? "" : "s"} — close or move them before deactivating` },
            { status: 409 });
      }

      await tx(async (cl) => {
        await cl.query(
          `UPDATE branch SET name=$2, print_name=$3, phone=$4, address_json=$5, active=$6, updated_by=$7
           WHERE id=$1`,
          [b.id, name, String(b.printName || "").trim() || null,
           String(b.phone || "").trim() || null,
           JSON.stringify({ line1: String(b.addressLine || "").trim() }),
           b.active !== false, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "branch", entityId: Number(b.id), action: "branch_updated",
          before: { name: cur.name, active: cur.active },
          after: { name, active: b.active !== false } });
      }, { entityIds: "ALL" });
      return NextResponse.json({ ok: true, id: Number(b.id) });
    }

    // —————————— create ——————————
    const existing = (await q(`SELECT code FROM branch`)).map(r => r.code);
    const v = validBranch({ ...b, existingCodes: existing });
    if (!v.ok) return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems }, { status: 400 });

    const ent = await one(`SELECT id FROM entity WHERE id=$1 AND active`, [b.entityId]);
    if (!ent) return NextResponse.json({ ok: false, reason: "That entity does not exist or is inactive" }, { status: 400 });

    const out = await tx(async (cl) => {
      const { rows: [r] } = await cl.query(
        `INSERT INTO branch (entity_id, code, name, print_name, phone, address_json, is_ho, active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,false,true,$7) RETURNING id`,
        [b.entityId, String(b.code).trim(), String(b.name).trim(),
         String(b.printName || "").trim() || null, String(b.phone || "").trim() || null,
         JSON.stringify({ line1: String(b.addressLine || "").trim() }), actor.employeeId]);
      // Gapless number series for every document type this branch will issue.
      await cl.query(`SELECT ensure_series($1, $2, d, $3)
                        FROM unnest(ARRAY['loan','receipt','packet','application','noc']::series_doc[]) AS d`,
        [b.entityId, r.id, fy()]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "branch", entityId: Number(r.id), action: "branch_created",
        after: { code: b.code, name: b.name, entityId: b.entityId } });
      return { id: Number(r.id) };
    }, { entityIds: "ALL" });

    return NextResponse.json({ ok: true, ...out,
      note: "The branch has no safes and no schemes yet — add a safe and allocate schemes before it can lend." });
  } catch (e) {
    console.error("[settings/branches] failed", e);
    return NextResponse.json({ ok: false,
      reason: "Save failed — " + (e.message || "unknown error") }, { status: 500 });
  }
}

const fy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };
