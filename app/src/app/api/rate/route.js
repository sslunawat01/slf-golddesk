import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q, one, tx, audit } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Maker saves a proposed rate; checker publishes it. Never the same person (R12). */
export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "save") {
    if (!can(actor, "rate_maker", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not propose the daily rate" }, { status: 403 });
    const rupees = Number(body.rupeesPerGram);
    if (!(rupees > 0) || rupees > 1000000)
      return NextResponse.json({ ok: false, reason: "Enter the 24K rate in rupees per gram" }, { status: 400 });
    const paise = Math.round(rupees * 100);

    const already = await one(
      `SELECT id FROM daily_rate WHERE rate_date = CURRENT_DATE AND metal_id = 1`);
    if (already) return NextResponse.json({ ok: false, reason: "Today's rate is already published — it cannot be edited" }, { status: 409 });

    await tx(async (c) => {
      await c.query(`DELETE FROM rate_draft WHERE rate_date = CURRENT_DATE AND metal_id = 1`);
      await c.query(
        `INSERT INTO rate_draft (rate_date, metal_id, base_paise, source_ref, maker_id)
         VALUES (CURRENT_DATE, 1, $1, $2, $3)`, [paise, body.sourceRef ?? null, actor.employeeId]);
      await audit(c, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "rate_draft", action: "rate_proposed", after: { base_paise: paise } });
    }, { entityIds: "ALL" });
    return NextResponse.json({ ok: true, state: "awaiting_checker" });
  }

  if (action === "publish") {
    if (!can(actor, "rate_checker", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not publish the daily rate" }, { status: 403 });
    const draft = await one(`SELECT * FROM rate_draft WHERE rate_date = CURRENT_DATE AND metal_id = 1`);
    if (!draft) return NextResponse.json({ ok: false, reason: "Nothing waiting to publish" }, { status: 404 });
    if (Number(draft.maker_id) === Number(actor.employeeId))
      return NextResponse.json({ ok: false, reason: "The checker must be a different person from the maker" }, { status: 403 });

    await tx(async (c) => {
      await c.query(
        `INSERT INTO daily_rate (rate_date, metal_id, base_paise, source_ref, maker_id, checker_id)
         VALUES (CURRENT_DATE, 1, $1, $2, $3, $4)`,
        [draft.base_paise, draft.source_ref, draft.maker_id, actor.employeeId]);
      await c.query(`DELETE FROM rate_draft WHERE id = $1`, [draft.id]);
      await audit(c, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "daily_rate", action: "rate_published", after: { base_paise: draft.base_paise } });
    }, { entityIds: "ALL" });
    return NextResponse.json({ ok: true, state: "published" });
  }

  return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
}
