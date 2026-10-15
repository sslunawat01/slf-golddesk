import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, audit } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settings · Limits (E32 №6, owner 15 Oct 2026). Two cash figures, kept in
 * app_setting and read by the disbursement and receipt checks (and by the
 * database trigger on cash payout legs):
 *   cash_disburse_below_paise   cash paid out on a loan must be BELOW this
 *   cash_receipt_day_max_paise  cash from one customer in a day, AT MOST this
 * The law says ₹20,000 (Sec 269SS) and ₹2,00,000 (Sec 269ST). The owner ruled
 * the setting may exceed those; the screen then shows the warning in red and
 * every change is audited with the old and new figures.
 */
export const LEGAL = { cash_disburse_below_paise: 2000000, cash_receipt_day_max_paise: 20000000 };
const KEYS = Object.keys(LEGAL);

export async function GET() {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "set_limits", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view limits" }, { status: 403 });
  const out = {};
  for (const k of KEYS) {
    const r = await one(`SELECT s.value, s.updated_at, e.full_name AS by FROM app_setting s
                           LEFT JOIN employee e ON e.id=s.updated_by WHERE s.key=$1`, [k]);
    out[k] = { paise: Number(r?.value ?? LEGAL[k]), legalPaise: LEGAL[k],
      updatedAt: r?.updated_at ?? null, by: r?.by ?? null };
  }
  return NextResponse.json({ ok: true, limits: out,
    canEdit: can(actor, "set_limits", { need: "edit" }).ok || can(actor, "set_limits", { need: "add" }).ok });
}

export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "set_limits", { need: "edit" }).ok && !can(actor, "set_limits", { need: "add" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not change limits" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const changes = [];
  for (const k of KEYS) {
    if (!(k in b)) continue;
    const paise = Math.round(Number(b[k]));
    if (!Number.isFinite(paise) || paise < 10000 || paise % 10000 !== 0)
      return NextResponse.json({ ok: false, reason: "Each limit is a whole-rupee figure of at least ₹100, in ₹100 steps" }, { status: 400 });
    const cur = await one(`SELECT value FROM app_setting WHERE key=$1`, [k]);
    if (Number(cur?.value ?? LEGAL[k]) !== paise) changes.push({ key: k, from: Number(cur?.value ?? LEGAL[k]), to: paise });
  }
  if (!changes.length) return NextResponse.json({ ok: true, unchanged: true });
  await tx(async (cl) => {
    for (const c of changes) {
      await cl.query(`INSERT INTO app_setting (key, value, updated_by) VALUES ($1, to_jsonb($2::bigint), $3)
                      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [c.key, c.to, actor.employeeId]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId, table: "app_setting", entityId: null,
        action: "limit_changed", before: { key: c.key, paise: c.from }, after: { key: c.key, paise: c.to,
          aboveLegal: c.to > LEGAL[c.key] } });
    }
  }, { entityIds: actor.entityIds });
  return NextResponse.json({ ok: true, changed: changes.length });
}
