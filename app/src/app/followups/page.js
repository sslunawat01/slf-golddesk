import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { redirect } from "next/navigation";
import FollowupsClient from "./FollowupsClient.js";
export const dynamic = "force-dynamic";

/** E33 — the dedicated Follow-ups tab. Needs the Collect desk (view). */
export default async function FollowupsPage({ searchParams }) {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  if (!can(actor, "collect", { need: "view" }).ok) redirect("/home");
  const sp = (await searchParams) || {};
  const focus = /^\d+$/.test(String(sp.focus || "")) ? Number(sp.focus) : null;
  const branches = (actor.branches || []).map(b => ({ id: Number(b.id), code: b.code, name: b.name }));
  return (
    <Shell>
      <FollowupsClient branches={branches} actingBranchId={Number(actor.actingBranchId)} focusLoanId={focus} />
    </Shell>);
}
