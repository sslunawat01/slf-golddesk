import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { fyOptions } from "@/lib/reports.js";
import { q } from "@/lib/db.js";
import { redirect } from "next/navigation";
import Client from "./Client.js";
export const dynamic = "force-dynamic";

/** E33 — Follow-up Register. */
export default async function Page() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "reports", { need: "view" }).ok) redirect("/home");
  const fy = await fyOptions();
  const branches = (actor.branches || []).map(b => ({ id: Number(b.id), code: b.code, name: b.name }));
  const staff = await q(`SELECT DISTINCT e.id, e.full_name FROM employee e JOIN employee_branch eb ON eb.employee_id = e.id
                          WHERE eb.branch_id = ANY($1::bigint[]) ORDER BY e.full_name`, [branches.map(b => b.id)]);
  return (
    <Shell>
      <Client fyOptions={fy.options} fyCurrent={fy.current} branches={branches}
        staff={staff.map(s => ({ id: Number(s.id), name: s.full_name }))} />
    </Shell>
  );
}
