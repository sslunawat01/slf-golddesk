import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, audit } from "@/lib/db.js";
import { vaultInReady, mismatchReady, qrPayload } from "@/lib/vault.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Packets still in counter custody at the acting branch, plus the safes they
 * can go into. Frozen packets stay on the list so nobody can forget one.
 */
async function waitingList(branchId) {
  return q(
    `SELECT p.id, p.packet_no AS "packetNo", p.status,
            l.id AS "loanId", l.loan_no AS "loanNo", l.disbursed_at AS "disbursedAt",
            c.full_name AS "customerName", b.code AS "branchCode",
            (SELECT coalesce(sum(ai.net_mg), 0) FROM appraisal_item ai
              WHERE ai.application_id = l.application_id)::int AS "netMg",
            (SELECT coalesce(sum(ai.qty), 0) FROM appraisal_item ai
              WHERE ai.application_id = l.application_id)::int AS "pieceCount"
       FROM packet p
       JOIN loan l     ON l.id = p.loan_id
       JOIN customer c ON c.id = l.customer_id
       JOIN branch b   ON b.id = l.branch_id
      WHERE l.branch_id = $1 AND p.status IN ('at_counter', 'frozen')
      ORDER BY l.disbursed_at, p.id`, [branchId]);
}

export async function GET() {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "vault", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not see the vault" }, { status: 403 });

  const rows = await waitingList(actor.actingBranchId);
  const safes = await q(
    `SELECT id, label FROM safe WHERE branch_id = $1 AND active ORDER BY label`,
    [actor.actingBranchId]);
  const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
  return NextResponse.json({ ok: true, rows, safes, today, canAct: can(actor, "vault", { need: "full" }).ok });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
    if (!can(actor, "vault", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not move gold in or out of a safe" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const packetId = Number(body.packetId);
    if (!packetId) return NextResponse.json({ ok: false, reason: "Which packet?" }, { status: 400 });

    const p = await one(
      `SELECT p.id, p.packet_no, p.status, p.loan_id,
              l.loan_no, l.branch_id, b.code AS branch_code,
              (SELECT coalesce(sum(ai.net_mg), 0) FROM appraisal_item ai
                WHERE ai.application_id = l.application_id)::int AS net_mg,
              (SELECT coalesce(sum(ai.qty), 0) FROM appraisal_item ai
                WHERE ai.application_id = l.application_id)::int AS piece_count
         FROM packet p
         JOIN loan l   ON l.id = p.loan_id
         JOIN branch b ON b.id = l.branch_id
        WHERE p.id = $1 AND l.branch_id = $2`, [packetId, actor.actingBranchId]);
    if (!p) return NextResponse.json({ ok: false, reason: "Packet not found at this branch" }, { status: 404 });

    // ————————————————————— put it in a safe —————————————————————
    if (body.action === "vault_in") {
      const safeId = Number(body.safeId) || null;
      if (safeId) {
        const s = await one(`SELECT id FROM safe WHERE id=$1 AND branch_id=$2 AND active`,
          [safeId, actor.actingBranchId]);
        if (!s) return NextResponse.json({ ok: false, reason: "That safe is not at this branch" }, { status: 400 });
      }
      const check = vaultInReady({
        sealIntact: !!body.sealIntact, itemsMatch: !!body.itemsMatch, weightMatch: !!body.weightMatch,
        sealPhotoFileId: body.sealPhotoFileId || null, safeId, packetStatus: p.status });
      if (!check.ok)
        return NextResponse.json({ ok: false, reason: check.problems[0], problems: check.problems }, { status: 400 });

      await tx(async (cl) => {
        await cl.query(
          `INSERT INTO vault_in_check (packet_id, seal_intact, counted_items, rechecked_net_mg,
             ok, checked_by, photo_file_id)
           VALUES ($1, true, $2, $3, true, $4, $5)`,
          [p.id, p.piece_count, p.net_mg, actor.employeeId, body.sealPhotoFileId]);
        await cl.query(
          `UPDATE packet SET status='in_safe', sealed_at=now(), seal_photo_file_id=$2, qr_payload=$3
            WHERE id=$1`,
          [p.id, body.sealPhotoFileId,
           qrPayload({ packetNo: p.packet_no, loanNo: p.loan_no, branchCode: p.branch_code })]);
        await cl.query(
          `INSERT INTO vault_movement (packet_id, direction, safe_id, reason, by_employee)
           VALUES ($1,'in',$2,'vault_in',$3)`, [p.id, safeId, actor.employeeId]);
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "packet", entityId: p.id, action: "packet_vaulted_in",
          before: { status: p.status },
          after: { status: "in_safe", safeId, netMg: p.net_mg, pieces: p.piece_count } });
      }, { entityIds: actor.entityIds });

      return NextResponse.json({ ok: true, status: "in_safe" });
    }

    // ————————————————————— report a mismatch —————————————————————
    if (body.action === "mismatch") {
      const note = String(body.note || "").trim();
      const check = mismatchReady({ reason: body.reason, note,
        photoFileId: body.photoFileId || null, packetStatus: p.status });
      if (!check.ok)
        return NextResponse.json({ ok: false, reason: check.problems[0], problems: check.problems }, { status: 400 });

      await tx(async (cl) => {
        // seal_intact records what the operator actually found, not a verdict
        await cl.query(
          `INSERT INTO vault_in_check (packet_id, seal_intact, counted_items, rechecked_net_mg,
             ok, checked_by, mismatch_reason, note, photo_file_id)
           VALUES ($1, $2, $3, $4, false, $5, $6::vault_mismatch_reason, $7, $8)`,
          [p.id, body.reason !== "seal_broken", Number(body.countedPieces ?? p.piece_count),
           Number(body.recheckedNetMg ?? p.net_mg), actor.employeeId, body.reason, note, body.photoFileId]);
        await cl.query(
          `UPDATE packet SET status='frozen', frozen_at=now(), frozen_by=$2 WHERE id=$1`,
          [p.id, actor.employeeId]);
        // no vault_movement row — the gold did not go into a safe
        await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
          table: "packet", entityId: p.id, action: "packet_frozen_on_mismatch",
          before: { status: p.status },
          after: { status: "frozen", reason: body.reason, note } });
      }, { entityIds: actor.entityIds });

      return NextResponse.json({ ok: true, status: "frozen" });
    }

    return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("[vault] action failed", e);
    return NextResponse.json({ ok: false,
      reason: "The action failed — " + (e.message || "unknown error") + " (nothing was saved)" }, { status: 500 });
  }
}
