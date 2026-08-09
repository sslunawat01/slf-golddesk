import Shell from "@/components/Shell.js";
import AddChargeClient from "./AddChargeClient.js";

export const dynamic = "force-dynamic";

export default async function AddChargePage({ params }) {
  const { id } = await params;
  return <Shell><AddChargeClient loanId={Number(id)} /></Shell>;
}
