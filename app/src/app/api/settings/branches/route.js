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
            b.address_json, b.phone2, b.email, b.latitude, b.longitude, b.active,
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
    // D-C (28 Aug 2026): the code IS editable now. On change, this financial
    // year's number-series prefixes refresh so documents issued from this
    // moment carry the new code; counters continue; old numbers stay forever.
    if (b.id) {
      const cur = await one(`SELECT * FROM branch WHERE id=$1`, [b.id]);
      if (!cur) return NextResponse.json({ ok: false, reason: "Branch not found" }, { status: 404 });
      const others = (await q(`SELECT code FROM branch WHERE id <> $1`, [b.id])).map(r => r.code);
      const v = cur.is_ho
        ? { ok: true, code: cur.code, name: String(b.name || "").trim(),
            printName: String(b.printName || "").trim() || null,
            phone: String(b.phone || "").replace(/\D/g, ""), phone2: String(b.phone2 || "").replace(/\D/g, ""),
            email: String(b.email || "").trim().toLowerCase(), address: String(b.address || "").trim(),
            latitude: Number(b.latitude) || null, longitude: Number(b.longitude) || null }
        : validBranch({ ...b, isEdit: true, existingCodes: others });
      if (!v.ok) return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems }, { status: 400 });
      const name = v.name;
      if (!name || name.length < 3)
        return NextResponse.json({ ok: false, reason: "Give the branch a name of at least 3 characters" }, { status: 400 });

      if (b.active === false) {
        const open = await one(
          `SELECT count(*)::int AS n FROM loan WHERE branch_id=$1 AND status='active'`, [b.id]);
        if (open.n > 0)
          return NextResponse.json({ ok: false,
            reason: `This branch still has ${open.n} active loan${open.n === 1 ? "" : "s"} — close or move them before deactivating` },
            { status: 409 });
      }

      const codeChanged = !cur.is_ho && v.code !== cur.code;
      await tx(async (cl) => {
        await cl.query(
          `UPDATE branch SET code=$2, name=$3, print_name=$4, phone=$5, phone2=$6, email=$7,
                  address_json=$8, latitude=$9, longitude=$10, active=$11, updated_by=$12
           WHERE id=$1`,
          [b.id, cur.is_ho ? cur.code : v.code, name, v.printName, v.phone || null,
           v.phone2 || null, v.email || null,
           JSON.stringify({ text: v.address, line1: v.address }),
           v.latitude, v.longitude, b.active !== false, actor.employeeId]);
        if (codeChanged) {
          // Refresh THIS financial year's prefixes by swapping ONLY the branch
          // code inside each existing prefix — custom tails (e.g. the live
          // '01A67' loan style) survive untouched. Counters continue.
          await cl.query(
            `UPDATE number_series SET prefix = CASE
                WHEN doc_type = 'loan' AND prefix LIKE $3 || '%'
                  THEN $4 || substr(prefix, length($3) + 1)
                WHEN position('-' || $3 || '-' IN prefix) > 0
                  THEN overlay(prefix PLACING '-' || $4 || '-'
                         FROM position('-' || $3 || '-' IN prefix)
                          FOR length($3) + 2)
                ELSE prefix END
              WHERE branch_id = $1 AND fy_label = $2`,
            [b.id, fy(), cur.code, v.code]);
        }
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "branch", entityId: Number(b.id), action: "branch_updated",
          before: { code: cur.code, name: cur.name, active: cur.active },
          after: { code: cur.is_ho ? cur.code : v.code, name, active: b.active !== false,
                   seriesPrefixRefreshed: codeChanged } });
      }, { entityIds: "ALL" });
      return NextResponse.json({ ok: true, id: Number(b.id),
        note: codeChanged
          ? `Code changed ${cur.code} → ${v.code}. Numbers issued from now use ${v.code}; counters continue; old numbers stay as printed.`
          : undefined });
    }

    // —————————— create ——————————
    const existing = (await q(`SELECT code FROM branch`)).map(r => r.code);
    const v = validBranch({ ...b, existingCodes: existing });
    if (!v.ok) return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems }, { status: 400 });

    const ent = await one(`SELECT id FROM entity WHERE id=$1 AND active`, [b.entityId]);
    if (!ent) return NextResponse.json({ ok: false, reason: "That entity does not exist or is inactive" }, { status: 400 });

    const out = await tx(async (cl) => {
      const { rows: [r] } = await cl.query(
        `INSERT INTO branch (entity_id, code, name, print_name, phone, phone2, email,
           address_json, latitude, longitude, is_ho, active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,true,$11) RETURNING id`,
        [b.entityId, v.code, v.name, v.printName, v.phone, v.phone2, v.email,
         JSON.stringify({ text: v.address, line1: v.address }),
         v.latitude, v.longitude, actor.employeeId]);
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
