import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { fyOptions } from "@/lib/reports.js";
import { q } from "@/lib/db.js";
import { redirect } from "next/navigation";
import Client from "./Client.js";
export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "reports", { need: "view" }).ok) redirect("/home");
  const fy = await fyOptions();
  const branches = (actor.branches || []).map(b => ({ id: Number(b.id), code: b.code, name: b.name }));
  const schemes = await q(`SELECT DISTINCT s.code FROM scheme s WHERE s.active ORDER BY s.code`);
  const accounts = await q(`SELECT id, nickname FROM slf_bank_account WHERE active ORDER BY nickname`);
  return (
    <Shell>
      <Client fyOptions={fy.options} fyCurrent={fy.current} branches={branches}
        schemes={schemes.map(s => s.code)}
        accounts={accounts.map(a => ({ id: Number(a.id), nickname: a.nickname }))} />
    </Shell>
  );
}
