import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { redirect } from "next/navigation";
import OverdueClient from "./OverdueClient.js";
export const dynamic = "force-dynamic";

export default async function OverduePage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "collect", { need: "view" }).ok) redirect("/home");
  return (
    <Shell title="Overdue">
      <OverdueClient />
    </Shell>);
}
