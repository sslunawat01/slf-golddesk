import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx } from "@/lib/db.js";
import { ornamentValue } from "@/lib/valuation.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save wizard progress. Values are recomputed server-side — the browser is never trusted. */
export async function PATCH(req, { params }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "appraise", { need: "full" }).ok)
    return NextResponse.json({ ok: false, reason: "Not permitted" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const app = await one(`SELECT * FROM loan_application WHERE id=$1 AND branch_id=$2`,
    [id, actor.actingBranchId]);
  if (!app) return NextResponse.json({ ok: false, reason: "Application not found" }, { status: 404 });
  if (!["draft", "appraised"].includes(app.status))
    return NextResponse.json({ ok: false, reason: `This application is ${app.status} and can no longer be edited` }, { status: 409 });

  const scheme = body.schemeVersionId
    ? await one(`SELECT id, funding_pct FROM scheme_version WHERE id=$1`, [body.schemeVersionId])
    : app.scheme_version_id
      ? await one(`SELECT id, funding_pct FROM scheme_version WHERE id=$1`, [app.scheme_version_id])
      : null;

  await tx(async (cl) => {
    await cl.query(
      `UPDATE loan_application SET scheme_version_id=COALESCE($2,scheme_version_id),
         requested_paise=$3, purpose=COALESCE($4,purpose), borrower_present=$5,
         presence_photo_id=$6, coborrower_customer_id=$7, coborrower_photo_id=$8,
         valuer1_id=$9, valuer2_id=$10, status=$11, updated_at=now(), updated_by=$12
       WHERE id=$1`,
      [id, body.schemeVersionId || null, body.requestedPaise ?? null, body.purpose || null,
       body.borrowerPresent ?? null, body.presencePhotoId ?? null, body.coborrowerCustomerId ?? null,
       body.coborrowerPhotoId ?? null, body.valuer1Id ?? null, body.valuer2Id ?? null,
       (body.items?.length ? "appraised" : app.status), actor.employeeId]);

    if (Array.isArray(body.documents)) {
      await cl.query(`DELETE FROM application_document WHERE application_id=$1`, [id]);
      for (const d of body.documents) {
        if (!d?.fileId) continue;
        await cl.query(
          `INSERT INTO application_document (application_id, file_id, note) VALUES ($1,$2,$3)`,
          [id, Number(d.fileId), String(d.note || "").trim() || null]);
      }
    }

    if (Array.isArray(body.items)) {
      await cl.query(`DELETE FROM appraisal_item WHERE application_id=$1`, [id]);
      for (const r of body.items) {
        if (!r.itemId || !(r.grossMg > 0) || !r.purityId) continue;
        const pur = await one(`SELECT purity_pct FROM purity WHERE id=$1`, [r.purityId]);
        const v = ornamentValue({ grossMg: Number(r.grossMg), stoneMg: Number(r.stoneMg || 0),
          purityPct: Number(pur.purity_pct), base24kPaise: Number(app.base_paise_snapshot),
          funding24kPaise: Number(app.funding_paise_snapshot ?? app.base_paise_snapshot),
          fundingPct: Number(scheme?.funding_pct ?? 0) });
        await cl.query(
          `INSERT INTO appraisal_item (application_id, item_id, qty, gross_mg, stone_mg, purity_id,
             purity_pct_snapshot, market_paise, funding_paise, narration)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, r.itemId, Number(r.qty || 1), Math.round(r.grossMg), Math.round(r.stoneMg || 0),
           r.purityId, pur.purity_pct, v.marketPaise, v.fundingPaise, r.narration || null]);
      }
    }
    if (Array.isArray(body.ornamentPhotoIds)) {
      await cl.query(`DELETE FROM application_photo WHERE application_id=$1`, [id]);
      for (const [i, fid] of body.ornamentPhotoIds.entries())
        await cl.query(`INSERT INTO application_photo (application_id, file_id, ord) VALUES ($1,$2,$3)`,
          [id, fid, i + 1]);
    }
  }, { entityIds: actor.entityIds });

  return NextResponse.json({ ok: true });
}
