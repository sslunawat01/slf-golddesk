import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q } from "@/lib/db.js";
import { redirect } from "next/navigation";
import ApprovalsClient from "./ApprovalsClient.js";
export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "sanction", { need: "full" }).ok || !can(actor, "settings", { need: "view" }).ok)
    redirect("/home");

  const waiting = await q(
    `SELECT h.id, h.amount_paise, h.submitted_at, h.recommended_by,
            a.id AS app_id, a.app_no, a.purpose,
            c.full_name AS customer, c.cust_no, c.mobile,
            b.code AS branch_code, b.name AS branch_name,
            s.code AS scheme, sv.funding_pct,
            e.full_name AS recommender,
            (SELECT COALESCE(sum(net_mg),0) FROM appraisal_item WHERE application_id=a.id)::int AS net_mg,
            (SELECT COALESCE(sum(market_paise),0) FROM appraisal_item WHERE application_id=a.id)::bigint AS market_paise,
            (SELECT COALESCE(sum(funding_paise),0) FROM appraisal_item WHERE application_id=a.id)::bigint AS funding_paise,
            (SELECT count(*) FROM appraisal_item WHERE application_id=a.id)::int AS item_count,
            v1.full_name AS valuer1, v2.full_name AS valuer2
       FROM ho_approval h
       JOIN loan_application a ON a.id = h.application_id
       JOIN customer c ON c.id = a.customer_id
       JOIN branch b ON b.id = a.branch_id
       LEFT JOIN scheme_version sv ON sv.id = a.scheme_version_id
       LEFT JOIN scheme s ON s.id = sv.scheme_id
       JOIN employee e ON e.id = h.recommended_by
       LEFT JOIN employee v1 ON v1.id = a.valuer1_id
       LEFT JOIN employee v2 ON v2.id = a.valuer2_id
      WHERE h.status = 'waiting' ORDER BY h.submitted_at`);

  const decided = await q(
    `SELECT h.id, h.amount_paise, h.status, h.decided_at, h.reject_reason,
            c.full_name AS customer, b.code AS branch_code, e.full_name AS decider
       FROM ho_approval h JOIN loan_application a ON a.id=h.application_id
       JOIN customer c ON c.id=a.customer_id JOIN branch b ON b.id=a.branch_id
       LEFT JOIN employee e ON e.id=h.decided_by
      WHERE h.status <> 'waiting' AND h.decided_at::date = CURRENT_DATE
      ORDER BY h.decided_at DESC`);

  return (
    <Shell title="Approvals">
      <p style={{ color: "var(--mut)", fontSize: 14, marginTop: -8, marginBottom: 18 }}>
        Pledges above the branch's sanction authority. The person who recommended a file
        can never be the one who decides it.
      </p>
      <ApprovalsClient waiting={waiting.map(r => ({ ...r, id: Number(r.id),
        amount_paise: Number(r.amount_paise), market_paise: Number(r.market_paise),
        funding_paise: Number(r.funding_paise), recommended_by: Number(r.recommended_by) }))}
        decided={decided.map(r => ({ ...r, id: Number(r.id), amount_paise: Number(r.amount_paise) }))}
        meId={actor.employeeId} />
    </Shell>
  );
}
