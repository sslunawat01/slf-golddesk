import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { NOTES, denomTotalPaise, expectedClosingPaise, dayBeginReady, dayEndReady }
  from "@/lib/daycycle.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Today's cash in and out at a branch, from the append-only tables. */
async function cashToday(branchId) {
  const rec = await one(
    `SELECT coalesce(sum(amount_paise),0)::bigint AS p FROM receipt
      WHERE branch_id=$1 AND business_date=CURRENT_DATE AND mode='cash'`, [branchId]);
  const dis = await one(
    `SELECT coalesce(sum(dl.amount_paise),0)::bigint AS p
       FROM disbursement_leg dl
       JOIN disbursement d ON d.id=dl.disbursement_id
       JOIN loan l ON l.id=d.loan_id
      WHERE l.branch_id=$1 AND d.created_at::date=CURRENT_DATE AND dl.kind='cash'`, [branchId]);
  return { cashReceiptsPaise: Number(rec.p), cashDisbursedPaise: Number(dis.p) };
}

/** Yesterday's (or the latest earlier) signed closing count — the carry-forward. */
async function carriedForward(branchId) {
  const r = await one(
    `SELECT business_date, end_counted_paise FROM day_cycle
      WHERE branch_id=$1 AND business_date < CURRENT_DATE AND end_signed_at IS NOT NULL
      ORDER BY business_date DESC LIMIT 1`, [branchId]);
  return r ? { fromDate: r.business_date, paise: Number(r.end_counted_paise) }
           : { fromDate: null, paise: 0 };
}

export async function GET() {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "dayend", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not see the day cycle" }, { status: 403 });

  const branchId = actor.actingBranchId;
  const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
  const cyc = await one(
    `SELECT * FROM day_cycle WHERE branch_id=$1 AND business_date=CURRENT_DATE`, [branchId]);
  const carry = await carriedForward(branchId);
  const flows = await cashToday(branchId);

  const openingPaise = cyc?.begin_signed_at ? Number(cyc.begin_counted_paise) : carry.paise;
  const expected = expectedClosingPaise({ openingPaise, ...flows });

  const hist = await q(
    `SELECT dc.business_date, dc.end_expected_paise, dc.end_counted_paise,
            dc.end_variance_paise, dc.begin_diff_reason, dc.end_reason,
            e.full_name AS signed_name, dc.end_signed_at
       FROM day_cycle dc LEFT JOIN employee e ON e.id=dc.end_signed_by
      WHERE dc.branch_id=$1 AND dc.end_signed_at IS NOT NULL
      ORDER BY dc.business_date DESC LIMIT 30`, [branchId]);

  return NextResponse.json({ ok: true, today, notes: NOTES,
    carry, flows, expectedPaise: expected,
    beginSigned: !!cyc?.begin_signed_at, endSigned: !!cyc?.end_signed_at,
    begin: cyc?.begin_signed_at ? { countedPaise: Number(cyc.begin_counted_paise),
      signedAt: cyc.begin_signed_at, checks: cyc.begin_checks,
      diffReason: cyc.begin_diff_reason } : null,
    end: cyc?.end_signed_at ? { countedPaise: Number(cyc.end_counted_paise),
      variancePaise: Number(cyc.end_variance_paise), reason: cyc.end_reason,
      signedAt: cyc.end_signed_at } : null,
    history: hist,
    canAct: can(actor, "dayend", { need: "full" }).ok });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
    if (!can(actor, "dayend", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not sign the day cycle" }, { status: 403 });

    const branchId = actor.actingBranchId;
    const b = await req.json().catch(() => ({}));
    const cyc = await one(
      `SELECT * FROM day_cycle WHERE branch_id=$1 AND business_date=CURRENT_DATE`, [branchId]);

    // ————————————— day-begin —————————————
    if (b.action === "begin") {
      const carry = await carriedForward(branchId);
      const countedPaise = Math.round(Number(b.countedPaise ?? NaN));
      const gate = dayBeginReady({ checks: b.checks || {}, countedPaise,
        carriedPaise: carry.paise, reason: b.reason,
        alreadySigned: !!cyc?.begin_signed_at });
      if (!gate.ok)
        return NextResponse.json({ ok: false, reason: gate.problems[0], problems: gate.problems }, { status: 400 });

      await tx(async (cl) => {
        await cl.query(
          `INSERT INTO day_cycle (branch_id, business_date, begin_opening_paise, begin_checks,
             begin_counted_paise, begin_diff_reason, begin_signed_by, begin_signed_at)
           VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, now())
           ON CONFLICT (branch_id, business_date) DO UPDATE SET
             begin_opening_paise=EXCLUDED.begin_opening_paise, begin_checks=EXCLUDED.begin_checks,
             begin_counted_paise=EXCLUDED.begin_counted_paise,
             begin_diff_reason=EXCLUDED.begin_diff_reason,
             begin_signed_by=EXCLUDED.begin_signed_by, begin_signed_at=now()`,
          [branchId, carry.paise, JSON.stringify(b.checks || {}), countedPaise,
           gate.diffPaise !== 0 ? String(b.reason || "").trim() : null, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId,
          table: "day_cycle", entityId: branchId, action: "day_begin_signed",
          after: { countedPaise, carriedPaise: carry.paise, diffPaise: gate.diffPaise } });
      }, { entityIds: actor.entityIds });
      return NextResponse.json({ ok: true, diffPaise: gate.diffPaise });
    }

    // ————————————— day-end —————————————
    if (b.action === "end") {
      const carry = await carriedForward(branchId);
      const flows = await cashToday(branchId);
      const openingPaise = cyc?.begin_signed_at ? Number(cyc.begin_counted_paise) : carry.paise;
      const expected = expectedClosingPaise({ openingPaise, ...flows });
      const countedPaise = denomTotalPaise(b.denoms || {});
      const gate = dayEndReady({ countedPaise, expectedPaise: expected,
        reason: b.reason, alreadySigned: !!cyc?.end_signed_at,
        beginSigned: !!cyc?.begin_signed_at });
      if (!gate.ok)
        return NextResponse.json({ ok: false, reason: gate.problems[0], problems: gate.problems }, { status: 400 });

      await tx(async (cl) => {
        const { rows: [dcRow] } = await cl.query(
          `UPDATE day_cycle SET end_expected_paise=$2, end_counted_paise=$3,
             end_variance_paise=$4, end_reason=$5, end_signed_by=$6, end_signed_at=now()
           WHERE branch_id=$1 AND business_date=CURRENT_DATE AND end_signed_at IS NULL
           RETURNING id`,
          [branchId, expected, countedPaise, gate.variancePaise,
           gate.variancePaise !== 0 ? String(b.reason || "").trim() : null,
           actor.employeeId]);
        if (!dcRow) throw new Error("day-begin missing or day already closed");
        for (const n of NOTES) {
          const count = Number((b.denoms || {})[n]) || 0;
          if (count > 0)
            await cl.query(
              `INSERT INTO day_denomination (day_cycle_id, phase, note_value, note_count)
               VALUES ($1,'end',$2,$3)
               ON CONFLICT (day_cycle_id, phase, note_value) DO UPDATE SET note_count=EXCLUDED.note_count`,
              [dcRow.id, n, count]);
        }
        await audit(cl, { employeeId: actor.employeeId, branchId,
          table: "day_cycle", entityId: Number(dcRow.id), action: "day_end_signed",
          after: { expectedPaise: expected, countedPaise, variancePaise: gate.variancePaise,
                   flows } });
      }, { entityIds: actor.entityIds });
      return NextResponse.json({ ok: true, variancePaise: gate.variancePaise,
        expectedPaise: expected, countedPaise });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[daycycle] failed", e);
    return NextResponse.json({ ok: false,
      reason: "Sign-off failed — " + (e.message || "unknown error") + " (nothing was saved)" },
      { status: 500 });
  }
}
