import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session.js";
import SetPwClient from "./SetPwClient.js";
export const dynamic = "force-dynamic";

/**
 * Set / change password. Two ways in (E35, owner 15 Oct 2026):
 *  · FORCED — a temporary password (new account, admin reset) sends the user here at
 *    sign-in; no current password is asked, there is nothing to prove.
 *  · VOLUNTARY — from the profile menu; the current password is required, so a
 *    signed-in but unattended screen cannot have its password changed by a passer-by.
 */
export default async function SetPwPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  return <SetPwClient forced={!!actor.forceChange} username={actor.username} fullName={actor.fullName} />;
}
