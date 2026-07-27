import Shell from "@/components/Shell.js";
import VaultInClient from "./VaultInClient.js";

export const dynamic = "force-dynamic";

export default async function VaultInPage({ params }) {
  const { id } = await params;
  return <Shell title="Recheck & vault-in"><VaultInClient packetId={Number(id)} /></Shell>;
}
