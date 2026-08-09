import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import DayCycleClient from "./DayCycleClient.js";

export const dynamic = "force-dynamic";

export default async function DayCyclePage() {
  const actor = await currentActor();
  if (actor && !can(actor, "dayend", { need: "view" }).ok) {
    return (
      <Shell title="Day begin / end">
        <div className="card"><span className="chip warn">You do not have day-cycle permission</span>
          <p style={{ marginTop: 10, color: "var(--mut)", fontSize: 14 }}>
            Ask Head Office for the <b>dayend</b> function, then sign out and back in.</p></div>
      </Shell>
    );
  }
  return <Shell title="Day begin / end"><DayCycleClient /></Shell>;
}
