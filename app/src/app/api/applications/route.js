import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, tx, issueNumber, audit } from "@/lib/db.js";
import { mayLend } from "@/lib/customer.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fy = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; };

/** Start a pledge. Refuses before it begins if the rate, KYC or blacklist say no. */
export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "appraise", { need: "full" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not start a pledge" }, { status: 403 });

  const { customerId } = await req.json().catch(() => ({}));
  const today = new Date().toISOString().slice(0, 10);

  const rate = await one(`SELECT base_paise FROM daily_rate
     WHERE rate_date = CURRENT_DATE AND metal_id = 1 ORDER BY published_at DESC LIMIT 1`);
  if (!rate) return NextResponse.json({ ok: false,
    reason: "Today's rate is not published — branches are locked for new lending" }, { status: 409 });

  const c = await one(`SELECT id, is_blacklisted, kyc_done_at, max_open_loans, max_outstanding_paise
     FROM customer WHERE id = $1`, [customerId]);
  if (!c) return NextResponse.json({ ok: false, reason: "Customer not found" }, { status: 404 });

  const lend = mayLend({ isBlacklisted: c.is_blacklisted, kycDoneAt: c.kyc_done_at }, today);
  if (!lend.ok) return NextResponse.json({ ok: false, reason: lend.reason }, { status: 409 });

  const openCount = await one(`SELECT count(*)::int AS n,
      COALESCE(sum(principal_paise),0)::bigint AS out FROM loan WHERE customer_id=$1 AND status='active'`, [customerId]);
  if (c.max_open_loans && openCount.n >= c.max_open_loans)
    return NextResponse.json({ ok: false,
      reason: `Customer already has ${openCount.n} open loans (limit ${c.max_open_loans})` }, { status: 409 });

  const draft = await one(`SELECT id FROM loan_application
     WHERE customer_id=$1 AND status='draft' AND branch_id=$2 ORDER BY id DESC LIMIT 1`,
    [customerId, actor.actingBranchId]);
  if (draft) return NextResponse.json({ ok: true, id: Number(draft.id), resumed: true });

  const out = await tx(async (cl) => {
    const appNo = await issueNumber(cl, { entityId: actor.actingBranch.entityId,
      branchId: actor.actingBranchId, docType: "application", fy: fy() });
    const { rows: [a] } = await cl.query(
      `INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status,
         rate_date, base_paise_snapshot, created_by)
       VALUES ($1,$2,$3,$4,'draft',CURRENT_DATE,$5,$6) RETURNING id`,
      [appNo, actor.actingBranch.entityId, actor.actingBranchId, customerId, rate.base_paise, actor.employeeId]);
    await cl.query(`INSERT INTO loan_state_history (application_id, to_state, by_employee, note)
                    VALUES ($1,'draft',$2,'pledge started')`, [a.id, actor.employeeId]);
    await audit(cl, { employeeId: actor.employeeId, branchId: actor.actingBranchId,
      table: "loan_application", entityId: a.id, action: "application_started", after: { appNo } });
    return { id: Number(a.id), appNo };
  }, { entityIds: actor.entityIds });

  return NextResponse.json({ ok: true, ...out });
}
