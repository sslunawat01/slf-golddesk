import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import SettingsClient from "./SettingsClient.js";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await currentActor();
  if (actor && !can(actor, "settings", { need: "view" }).ok) {
    return (
      <Shell title="Settings & admin">
        <div className="card"><span className="chip warn">You do not have settings permission</span>
          <p style={{ marginTop: 10, color: "var(--mut)", fontSize: 14 }}>
            Settings is Head Office territory. Ask for the <b>settings</b> function on your role,
            then sign out and back in.</p></div>
      </Shell>
    );
  }
  return <Shell title="Settings & admin"><SettingsClient /></Shell>;
}
