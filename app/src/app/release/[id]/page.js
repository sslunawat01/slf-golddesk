import Shell from "@/components/Shell.js";
import ReleaseClient from "./ReleaseClient.js";

export const dynamic = "force-dynamic";

export default async function ReleasePage({ params }) {
  const { id } = await params;
  return <Shell><ReleaseClient loanId={Number(id)} /></Shell>;
}
