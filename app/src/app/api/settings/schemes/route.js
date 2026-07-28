import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { validSchemeVersion } from "@/lib/masters.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function guard(actor, need) {
  if (!actor) return { status: 401, reason: "Signed out" };
  if (!can(actor, "settings", { need }).ok)
    return { status: 403, reason: "You may not manage settings" };
  return null;
}

/** Draft version row → the shape the validator and the form share. */
function toForm(sv, slabs) {
  return {
    calcMethod: sv.calc_method, interestPct: sv.interest_pct == null ? null : Number(sv.interest_pct),
    slabMode: sv.slab_mode,
    slabs: slabs.map(s => ({ fromDay: Number(s.from_day), toDay: Number(s.to_day), ratePct: Number(s.rate_pct) })),
    daysInYear: Number(sv.days_in_year), minInterestDays: Number(sv.min_interest_days),
    tenureDays: Number(sv.tenure_days), penalRatePct: Number(sv.penal_rate_pct),
    penalGraceDays: Number(sv.penal_grace_days), fundingPct: Number(sv.funding_pct),
    minLoanRs: Number(sv.min_loan_paise) / 100, maxLoanRs: Number(sv.max_loan_paise) / 100,
    docChargePct: Number(sv.doc_charge_pct), docMinRs: Number(sv.doc_charge_min_paise) / 100,
    docMaxRs: Number(sv.doc_charge_max_paise) / 100, effectiveFrom: sv.effective_from,
  };
}

export async function GET() {
  const actor = await currentActor();
  const g = guard(actor, "view");
  if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

  const schemes = await q(`SELECT id, code, name, metal_id, active FROM scheme ORDER BY code`);
  const versions = await q(
    `SELECT sv.*, e1.full_name AS maker_name, e2.full_name AS checker_name,
            (SELECT count(*) FROM loan l WHERE l.scheme_version_id = sv.id)::int AS loans_on_it
       FROM scheme_version sv
       LEFT JOIN employee e1 ON e1.id = sv.maker_id
       LEFT JOIN employee e2 ON e2.id = sv.checker_id
      ORDER BY sv.scheme_id, sv.version_no`);
  const slabs = await q(`SELECT * FROM scheme_slab ORDER BY scheme_version_id, from_day`);
  const alloc = await q(
    `SELECT sb.scheme_version_id, sb.branch_id FROM scheme_branch sb`);
  const branches = await q(
    `SELECT id, code, name, is_ho FROM branch WHERE active ORDER BY id`);

  return NextResponse.json({ ok: true, schemes, versions, slabs, alloc, branches,
    canEdit: can(actor, "settings", { need: "full" }).ok });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    const g = guard(actor, "full");
    if (g) return NextResponse.json({ ok: false, reason: g.reason }, { status: g.status });

    const b = await req.json().catch(() => ({}));
    const action = b.action;

    // ————————— create a scheme, or a new version of one —————————
    if (action === "save_draft") {
      const isNew = !b.schemeId;
      const existingCodes = (await q(`SELECT code FROM scheme`)).map(r => r.code);
      const v = validSchemeVersion({ ...b.form, code: b.code, name: b.name,
        isNewScheme: isNew, existingCodes });
      if (!v.ok) return NextResponse.json({ ok: false, reason: v.problems[0], problems: v.problems }, { status: 400 });

      const f = b.form;
      const out = await tx(async (cl) => {
        let schemeId = b.schemeId;
        if (isNew) {
          const { rows: [s] } = await cl.query(
            `INSERT INTO scheme (code, name, metal_id, active, created_by)
             VALUES ($1,$2,1,true,$3) RETURNING id`,
            [String(b.code).trim().toUpperCase(), String(b.name).trim(), actor.employeeId]);
          schemeId = Number(s.id);
          // every role may sanction every scheme — the owner's standing default
          await cl.query(`INSERT INTO role_scheme (role_id, scheme_id)
                            SELECT r.id, $1 FROM role r ON CONFLICT DO NOTHING`, [schemeId]);
        }

        let versionId = b.versionId;
        if (versionId) {
          // editing an existing DRAFT — published versions are immutable
          const cur = await one(`SELECT status FROM scheme_version WHERE id=$1 AND scheme_id=$2`,
            [versionId, schemeId]);
          if (!cur) return { err: "Version not found" };
          if (cur.status !== "draft") return { err: "A published version can never be edited — create a new version" };
          await cl.query(
            `UPDATE scheme_version SET effective_from=$2, funding_pct=$3, calc_method=$4::calc_method,
               interest_pct=$5, slab_mode=$6::slab_mode, days_in_year=$7, min_interest_days=$8,
               tenure_days=$9, penal_rate_pct=$10, penal_grace_days=$11, doc_charge_pct=$12,
               doc_charge_min_paise=$13, doc_charge_max_paise=$14, min_loan_paise=$15,
               max_loan_paise=$16, updated_by=$17
             WHERE id=$1`,
            [versionId, f.effectiveFrom, f.fundingPct, f.calcMethod,
             f.calcMethod === "simple" ? f.interestPct : null,
             f.slabMode || "retroactive", f.daysInYear, f.minInterestDays, f.tenureDays,
             f.penalRatePct, f.penalGraceDays, f.docChargePct,
             Math.round(Number(f.docMinRs || 0) * 100), Math.round(Number(f.docMaxRs || 0) * 100),
             Math.round(Number(f.minLoanRs || 0) * 100), Math.round(Number(f.maxLoanRs || 0) * 100),
             actor.employeeId]);
          await cl.query(`DELETE FROM scheme_slab WHERE scheme_version_id=$1`, [versionId]);
        } else {
          const { rows: [mx] } = await cl.query(
            `SELECT coalesce(max(version_no),0)::int AS n FROM scheme_version WHERE scheme_id=$1`, [schemeId]);
          const { rows: [nv] } = await cl.query(
            `INSERT INTO scheme_version (scheme_id, version_no, effective_from, funding_pct,
               calc_method, interest_pct, slab_mode, days_in_year, min_interest_days,
               tenure_days, penal_rate_pct, penal_grace_days, doc_charge_pct,
               doc_charge_min_paise, doc_charge_max_paise, admin_fee_paise,
               min_loan_paise, max_loan_paise, round_step_paise, status, created_by)
             VALUES ($1,$2,$3,$4,$5::calc_method,$6,$7::slab_mode,$8,$9,$10,$11,$12,$13,$14,$15,0,
                     $16,$17,1000,'draft',$18) RETURNING id`,
            [schemeId, mx.n + 1, f.effectiveFrom, f.fundingPct, f.calcMethod,
             f.calcMethod === "simple" ? f.interestPct : null,
             f.slabMode || "retroactive", f.daysInYear, f.minInterestDays, f.tenureDays,
             f.penalRatePct, f.penalGraceDays, f.docChargePct,
             Math.round(Number(f.docMinRs || 0) * 100), Math.round(Number(f.docMaxRs || 0) * 100),
             Math.round(Number(f.minLoanRs || 0) * 100), Math.round(Number(f.maxLoanRs || 0) * 100),
             actor.employeeId]);
          versionId = Number(nv.id);
        }

        if (f.calcMethod === "slab") {
          for (const sl of f.slabs) {
            await cl.query(
              `INSERT INTO scheme_slab (scheme_version_id, from_day, to_day, rate_pct)
               VALUES ($1,$2,$3,$4)`,
              [versionId, Math.max(1, Number(sl.fromDay)), Number(sl.toDay), Number(sl.ratePct)]);
          }
        }

        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "scheme_version", entityId: versionId,
          action: b.versionId ? "scheme_draft_updated" : "scheme_draft_created",
          after: { schemeId, calcMethod: f.calcMethod } });
        return { schemeId, versionId };
      }, { entityIds: "ALL" });

      if (out.err) return NextResponse.json({ ok: false, reason: out.err }, { status: 409 });
      return NextResponse.json({ ok: true, ...out });
    }

    // ————————— publish a draft —————————
    // W6: single-person publish, relaxed by migration 010. When maker/checker
    // arrives, this becomes submit-for-approval instead.
    if (action === "publish") {
      const sv = await one(`SELECT * FROM scheme_version WHERE id=$1`, [b.versionId]);
      if (!sv) return NextResponse.json({ ok: false, reason: "Version not found" }, { status: 404 });
      if (sv.status !== "draft")
        return NextResponse.json({ ok: false, reason: `This version is already ${sv.status}` }, { status: 409 });

      const slabs = await q(`SELECT * FROM scheme_slab WHERE scheme_version_id=$1 ORDER BY from_day`, [b.versionId]);
      const scheme = await one(`SELECT code, name FROM scheme WHERE id=$1`, [sv.scheme_id]);
      const v = validSchemeVersion({ ...toForm(sv, slabs), code: scheme.code, name: scheme.name,
        isNewScheme: false, existingCodes: [] });
      if (!v.ok) return NextResponse.json({ ok: false,
        reason: "Cannot publish: " + v.problems[0], problems: v.problems }, { status: 400 });

      const branchIds = (b.branchIds || []).map(Number).filter(Boolean);
      if (!branchIds.length)
        return NextResponse.json({ ok: false, reason: "Tick at least one branch that may lend on this scheme" }, { status: 400 });
      const ho = await q(`SELECT id FROM branch WHERE id = ANY($1) AND is_ho`, [branchIds]);
      if (ho.length)
        return NextResponse.json({ ok: false, reason: "Head Office cannot lend — untick it" }, { status: 400 });

      await tx(async (cl) => {
        // supersede the previous published version the day this one starts
        await cl.query(
          `UPDATE scheme_version SET effective_to = ($2::date - 1), updated_by=$3
            WHERE scheme_id=$1 AND status='published' AND effective_to IS NULL`,
          [sv.scheme_id, sv.effective_from, actor.employeeId]);
        await cl.query(
          `UPDATE scheme_version SET status='published', maker_id=$2, published_at=now(), updated_by=$2
            WHERE id=$1`, [b.versionId, actor.employeeId]);
        await cl.query(`DELETE FROM scheme_branch WHERE scheme_version_id=$1`, [b.versionId]);
        for (const bid of branchIds)
          await cl.query(`INSERT INTO scheme_branch (scheme_version_id, branch_id) VALUES ($1,$2)`,
            [b.versionId, bid]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "scheme_version", entityId: Number(b.versionId), action: "scheme_published_single_signed",
          after: { schemeId: sv.scheme_id, branches: branchIds,
                   note: "W6 single-person publish — maker/checker pending" } });
      }, { entityIds: "ALL" });

      return NextResponse.json({ ok: true });
    }

    // ————————— allocation on an already-published version —————————
    if (action === "allocate") {
      const sv = await one(`SELECT * FROM scheme_version WHERE id=$1 AND status='published'`, [b.versionId]);
      if (!sv) return NextResponse.json({ ok: false, reason: "No published version with that id" }, { status: 404 });
      const branchIds = (b.branchIds || []).map(Number).filter(Boolean);
      if (!branchIds.length)
        return NextResponse.json({ ok: false, reason: "Tick at least one branch" }, { status: 400 });
      const ho = await q(`SELECT id FROM branch WHERE id = ANY($1) AND is_ho`, [branchIds]);
      if (ho.length)
        return NextResponse.json({ ok: false, reason: "Head Office cannot lend — untick it" }, { status: 400 });

      await tx(async (cl) => {
        await cl.query(`DELETE FROM scheme_branch WHERE scheme_version_id=$1`, [b.versionId]);
        for (const bid of branchIds)
          await cl.query(`INSERT INTO scheme_branch (scheme_version_id, branch_id) VALUES ($1,$2)`,
            [b.versionId, bid]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "scheme_branch", entityId: Number(b.versionId), action: "scheme_allocation_changed",
          after: { branches: branchIds } });
      }, { entityIds: "ALL" });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[settings/schemes] failed", e);
    return NextResponse.json({ ok: false,
      reason: "Save failed — " + (e.message || "unknown error") }, { status: 500 });
  }
}
