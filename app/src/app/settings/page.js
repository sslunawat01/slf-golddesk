import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can, SETTINGS_FNS } from "@/lib/policy.js";
import SettingsClient from "./SettingsClient.js";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const actor = await currentActor();
  const TAB_FN = { Charges: "set_charges", Branches: "set_branches", Schemes: "set_schemes",
    Roles: "set_roles", Employees: "set_employees", Metals: "set_metals",
    Items: "set_items", Banks: "set_banks" };
  const visibleTabs = actor
    ? Object.entries(TAB_FN).filter(([, fn]) => can(actor, fn, { need: "view" }).ok)
        .map(([t]) => t)
    : [];
  if (actor && visibleTabs.length === 0) {
    return (
      <Shell title="Settings & admin">
        <div className="card"><span className="chip warn">You do not have settings permission</span>
          <p style={{ marginTop: 10, color: "var(--mut)", fontSize: 14 }}>
            Settings is Head Office territory. Each tab is its own permission now — ask for
            View on the tab you need (e.g. <b>Settings · Schemes</b>), then sign out and back in.</p></div>
      </Shell>
    );
  }
  return <Shell title="Settings & admin"><SettingsClient visibleTabs={visibleTabs} /></Shell>;
}
