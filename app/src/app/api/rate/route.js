import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, audit } from "@/lib/db.js";
import { sanityCheck, validRatePair } from "@/lib/rate.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Single-person publish with a sanity guard. The rate then carries forward until changed. */
export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "rate_maker", { need: "full" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not set the daily rate" }, { status: 403 });

  const { marketRupees, fundingRupees, confirmed, sourceRef, referenceRupees } =
    await req.json().catch(() => ({}));
  const pair = validRatePair(marketRupees, fundingRupees);
  if (!pair.ok) return NextResponse.json({ ok: false, reason: pair.reason, field: pair.field }, { status: 400 });
  const paise = Math.round(Number(marketRupees) * 100);
  const fundingPaise = Math.round(Number(fundingRupees) * 100);

  const current = await one(`SELECT * FROM rate_in_force(1, CURRENT_DATE)`);
  const warnPct = Number((await one(`SELECT value FROM app_setting WHERE key='rate_jump_warn_pct'`))?.value ?? 5);
  const check = sanityCheck(paise, current ? Number(current.base_paise) : null, warnPct);

  if (check.needsConfirm && !confirmed)
    return NextResponse.json({ ok: false, needsConfirm: true, reason: check.message,
      pct: check.pct, currentPaise: current ? Number(current.base_paise) : null }, { status: 409 });

  if (current && Number(current.base_paise) === paise && Number(current.funding_paise) === fundingPaise
      && current.rate_date === new Date().toISOString().slice(0, 10))
    return NextResponse.json({ ok: false, reason: "Those are already today's rates" }, { status: 409 });

  await tx(async (cl) => {
    // one rate per date: re-publishing today replaces today's row, history is kept in audit
    await cl.query(`DELETE FROM daily_rate WHERE rate_date = CURRENT_DATE AND metal_id = 1`);
    await cl.query(
      `INSERT INTO daily_rate (rate_date, metal_id, base_paise, funding_paise, reference_paise,
         source_ref, maker_id, checker_id, jump_pct, jump_confirmed)
       VALUES (CURRENT_DATE, 1, $1, $2, $3, $4, $5, $5, $6, $7)`,
      [paise, fundingPaise, referenceRupees ? Math.round(Number(referenceRupees) * 100) : null,
       sourceRef || null, actor.employeeId, Number(check.pct.toFixed(3)), !!check.needsConfirm]);
    await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
      table: "daily_rate", action: "rate_published",
      before: current ? { base_paise: Number(current.base_paise), rate_date: current.rate_date } : null,
      after: { base_paise: paise, funding_paise: fundingPaise, haircut_pct: Number(pair.haircutPct.toFixed(2)),
               jump_pct: Number(check.pct.toFixed(3)), confirmed: !!check.needsConfirm } });
  }, { entityIds: "ALL" });

  return NextResponse.json({ ok: true });
}
