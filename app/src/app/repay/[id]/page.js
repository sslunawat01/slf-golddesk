import Shell from "@/components/Shell.js";
import RepayClient from "./RepayClient.js";

export const dynamic = "force-dynamic";

export default async function RepayPage({ params }) {
  const { id } = await params;
  return <Shell><RepayClient loanId={Number(id)} /></Shell>;
}
