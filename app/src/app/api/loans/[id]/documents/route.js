import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, audit } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * №11 — attach a document to a LIVE loan. The file rides on the loan's own
 * application (application_document), so pledge-time and later documents live
 * in one place. Append-only from this endpoint: rows are added, never edited.
 */
export async function POST(req, { params }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "appraise", { need: "full" }).ok && !can(actor, "collect", { need: "full" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not attach documents" }, { status: 403 });

  const { id } = await params;
  const loan = await one(
    `SELECT id, loan_no, application_id, branch_id FROM loan WHERE id = $1`, [id]);
  if (!loan) return NextResponse.json({ ok: false, reason: "Loan not found" }, { status: 404 });
  if (Number(loan.branch_id) !== Number(actor.actingBranchId))
    return NextResponse.json({ ok: false, reason: "That loan belongs to another branch" }, { status: 403 });

  const b = await req.json().catch(() => ({}));
  if (!Number(b.fileId))
    return NextResponse.json({ ok: false, reason: "No document to attach" }, { status: 400 });
  const note = String(b.note || "").trim();
  if (note.length < 3)
    return NextResponse.json({ ok: false,
      reason: "Say what the document is — at least 3 characters" }, { status: 400 });

  try {
    await tx(async (cl) => {
      await cl.query(
        `INSERT INTO application_document (application_id, file_id, note) VALUES ($1,$2,$3)`,
        [loan.application_id, Number(b.fileId), note]);
      await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
        table: "application_document", entityId: loan.id, action: "loan_document",
        after: { loanNo: loan.loan_no, note } });
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, reason: "The document could not be attached" }, { status: 500 });
  }
}
