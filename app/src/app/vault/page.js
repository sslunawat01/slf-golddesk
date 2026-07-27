import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import VaultListClient from "./VaultListClient.js";

export const dynamic = "force-dynamic";

export default async function VaultPage() {
  const actor = await currentActor();
  if (actor && !can(actor, "vault", { need: "view" }).ok) {
    return (
      <Shell title="Vault-in due">
        <div className="card"><span className="chip warn">You do not have vault permission</span>
          <p style={{ marginTop: 10, color: "var(--mut)", fontSize: 14 }}>
            Ask Head Office to grant the <b>vault</b> function to your role, then sign out and back in.
          </p></div>
      </Shell>
    );
  }
  return <Shell title="Vault-in due"><VaultListClient /></Shell>;
}
