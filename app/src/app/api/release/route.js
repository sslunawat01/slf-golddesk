import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q, tx, issueNumber, audit } from "@/lib/db.js";
import { releaseReady, slaDay, releaseWhatsapp } from "@/lib/release.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };

/** Closed loans whose gold has not yet left the branch. */
async function dueList(branchId) {
  return q(
    `SELECT l.id AS "loanId", l.loan_no AS "loanNo", l.closed_at AS "closedAt",
            l.entity_id, c.full_name AS "customerName", c.mobile,
            p.id AS "packetId", p.packet_no AS "packetNo", p.status AS "packetStatus",
            b.code AS "branchCode",
            (SELECT coalesce(sum(ai.net_mg),0) FROM appraisal_item ai
              WHERE ai.application_id = l.application_id)::int AS "netMg"
       FROM loan l
       JOIN customer c ON c.id = l.customer_id
       JOIN branch b ON b.id = l.branch_id
       JOIN packet p ON p.loan_id = l.id
      WHERE l.branch_id = $1 AND l.status = 'closed' AND p.status <> 'out'
      ORDER BY l.closed_at, l.id`, [branchId]);
}

export async function GET() {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "vault", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not see releases" }, { status: 403 });

  const rows = await dueList(actor.actingBranchId);
  const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
  const holidays = (await q(
    `SELECT day::text AS d FROM holiday WHERE (branch_id IS NULL OR branch_id = $1)`,
    [actor.actingBranchId]).catch(() => [])).map(r => r.d);

  return NextResponse.json({ ok: true, today, holidays,
    rows: rows.map(r => ({ ...r, slaDay: slaDay(String(r.closedAt), today, holidays) })),
    canAct: can(actor, "vault", { need: "full" }).ok });
}

export async function POST(req) {
  try {
    const actor = await currentActor();
    if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
    if (!can(actor, "vault", { need: "full" }).ok)
      return NextResponse.json({ ok: false, reason: "You may not release gold" }, { status: 403 });

    const b = await req.json().catch(() => ({}));
    const loanId = Number(b.loanId);
    if (!loanId) return NextResponse.json({ ok: false, reason: "Which loan?" }, { status: 400 });

    const r = await one(
      `SELECT l.id, l.loan_no, l.status AS loan_status, l.closed_at, l.entity_id, l.branch_id,
              c.full_name AS customer_name, c.mobile,
              p.id AS packet_id, p.packet_no, p.status AS packet_status,
              (SELECT coalesce(sum(ai.net_mg),0) FROM appraisal_item ai
                WHERE ai.application_id = l.application_id)::int AS net_mg,
              (SELECT dues.sum FROM (SELECT coalesce(sum(r2.amount_paise),0) AS sum
                 FROM receipt r2 WHERE r2.loan_id = l.id AND r2.closes_loan) dues) AS closing_receipt
         FROM loan l
         JOIN customer c ON c.id = l.customer_id
         JOIN packet p ON p.loan_id = l.id
        WHERE l.id = $1 AND l.branch_id = $2`, [loanId, actor.actingBranchId]);
    if (!r) return NextResponse.json({ ok: false, reason: "Loan not found at this branch" }, { status: 404 });

    // The vault-in safe this packet sits in, for the out-movement row.
    const lastMove = await one(
      `SELECT safe_id FROM vault_movement WHERE packet_id=$1 AND direction='in'
        ORDER BY at DESC LIMIT 1`, [r.packet_id]);

    const gate = releaseReady({
      loanStatus: r.loan_status, packetStatus: r.packet_status,
      identityOk: !!b.identityOk, sealOk: !!b.sealOk,
      handoverPhotoId: b.handoverPhotoId || null,
      collectedBy: b.collectedBy || "borrower" });
    if (!gate.ok)
      return NextResponse.json({ ok: false, reason: gate.problems[0], problems: gate.problems }, { status: 400 });

    const out = await tx(async (cl) => {
      const nocNo = await issueNumber(cl, { entityId: r.entity_id, branchId: r.branch_id,
        docType: "noc", fy: fy() });

      // one release row per loan, created or completed here
      await cl.query(
        `INSERT INTO release (loan_id, due_from, identity_ok, seal_ok, handover_photo_id,
           released_at, released_by, noc_no)
         VALUES ($1, $2, true, true, $3, now(), $4, $5)
         ON CONFLICT (loan_id) DO UPDATE SET identity_ok=true, seal_ok=true,
           handover_photo_id=EXCLUDED.handover_photo_id, released_at=now(),
           released_by=EXCLUDED.released_by, noc_no=EXCLUDED.noc_no`,
        [r.id, r.closed_at, b.handoverPhotoId, actor.employeeId, nocNo]);

      // the gold leaves the branch — this is the custody event
      if (r.packet_status === "in_safe" && lastMove?.safe_id) {
        await cl.query(
          `INSERT INTO vault_movement (packet_id, direction, safe_id, reason, by_employee)
           VALUES ($1,'out',$2,'release',$3)`, [r.packet_id, lastMove.safe_id, actor.employeeId]);
      }
      await cl.query(`UPDATE packet SET status='out' WHERE id=$1`, [r.packet_id]);

      await cl.query(
        `UPDATE loan SET status='released', updated_by=$2 WHERE id=$1`, [r.id, actor.employeeId]);
      await cl.query(
        `INSERT INTO loan_state_history (loan_id, from_state, to_state, by_employee, note)
         VALUES ($1,'closed','released',$2,$3)`,
        [r.id, actor.employeeId, `gold handed to borrower · NOC ${nocNo}`]);

      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "release", entityId: Number(r.id), action: "gold_released",
        after: { loanNo: r.loan_no, packetNo: r.packet_no, netMg: r.net_mg,
                 nocNo, collectedBy: "borrower" } });
      return { nocNo };
    }, { entityIds: actor.entityIds });

    const grams = (r.net_mg / 1000).toFixed(3);
    return NextResponse.json({ ok: true, ...out, grams,
      loanNo: r.loan_no, packetNo: r.packet_no, customerName: r.customer_name,
      mobile: r.mobile,
      whatsapp: releaseWhatsapp({ customerName: r.customer_name, grams, loanNo: r.loan_no }) });
  } catch (e) {
    console.error("[release] failed", e);
    return NextResponse.json({ ok: false,
      reason: "Release failed — " + (e.message || "unknown error") + " (nothing was saved)" },
      { status: 500 });
  }
}
