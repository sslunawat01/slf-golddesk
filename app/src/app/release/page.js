import Shell from "@/components/Shell.js";
import ReleaseListClient from "./ReleaseListClient.js";

export const dynamic = "force-dynamic";

export default function ReleaseListPage() {
  return <Shell title="Gold release due"><ReleaseListClient /></Shell>;
}
