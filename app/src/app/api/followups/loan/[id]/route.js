import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { one, q } from "@/lib/db.js";
import { loanHistory, loanPosition } from "@/lib/followups-db.js";
import { suggestFor, labelType } from "@/lib/followups.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — one loan's follow-up history + position + suggestion (the History panel and the loan section). */
export async function GET(req, { params }) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  if (!can(actor, "collect", { need: "view" }).ok)
    return NextResponse.json({ ok: false, reason: "You may not view follow-ups" }, { status: 403 });
  const { id } = await params;
  const loan = await one(`SELECT l.id, l.loan_no, l.branch_id, l.status, c.id AS customer_id, c.full_name AS customer, c.cust_no, c.mobile,
                                 c.warning_remark, c.blacklist_remark, s.code AS scheme_code
                            FROM loan l JOIN customer c ON c.id=l.customer_id
                            JOIN scheme_version sv ON sv.id=l.scheme_version_id JOIN scheme s ON s.id=sv.scheme_id WHERE l.id=$1`, [Number(id)]);
  if (!loan) return NextResponse.json({ ok: false, reason: "Loan not found" }, { status: 404 });
  if (!(actor.branchIds || []).includes(Number(loan.branch_id)))
    return NextResponse.json({ ok: false, reason: "That loan belongs to a branch you are not posted to" }, { status: 403 });
  try {
    const today = (await one(`SELECT CURRENT_DATE::text AS d`)).d;
    const [h, pos] = await Promise.all([loanHistory(Number(id), today), loanPosition(Number(id), today)]);
    const noticeSent = !!(await one(`SELECT 1 FROM notice WHERE loan_id=$1 LIMIT 1`, [Number(id)]));
    const brokenPtp = h.items[0]?.ptp === "broken";
    const s = loan.status === "active" ? suggestFor({ unpaidDays: pos.unpaidDays, ageDays: pos.ageDays, tenureDays: pos.tenureDays,
      graceDays: pos.graceDays, noticeSent, brokenPtp, hasOpenDue: !!h.due }) : null;
    const staff = await q(`SELECT e.id, e.full_name FROM employee e JOIN employee_branch eb ON eb.employee_id=e.id
                            WHERE e.status='active' AND eb.branch_id=$1 AND eb.effective_to IS NULL ORDER BY e.full_name`, [loan.branch_id]);
    return NextResponse.json({ ok: true, today,
      loan: { id: Number(loan.id), loanNo: loan.loan_no, status: loan.status, scheme: loan.scheme_code,
        customerId: Number(loan.customer_id), customer: loan.customer, custNo: loan.cust_no, mobile: loan.mobile,
        warningRemark: loan.warning_remark, blacklistRemark: loan.blacklist_remark,
        principalPaise: pos.principalPaise, dueTodayPaise: pos.dueTodayPaise, interestDuePaise: pos.interestDuePaise,
        penalDuePaise: pos.penalDuePaise, unpaidDays: pos.unpaidDays, ageDays: pos.ageDays },
      ...h, suggestion: s ? { ...s, typeLabel: labelType(s.type) } : null,
      staff: staff.map(x => ({ id: Number(x.id), name: x.full_name })),
      me: Number(actor.employeeId), canLog: can(actor, "collect", { need: "full" }).ok && loan.status === "active" });
  } catch (e) {
    console.error("[followups/loan] failed", e);
    return NextResponse.json({ ok: false, reason: "Could not load the follow-up history" }, { status: 500 });
  }
}
