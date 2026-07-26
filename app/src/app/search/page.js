import Shell from "@/components/Shell.js";
import SearchClient from "./SearchClient.js";
export const dynamic = "force-dynamic";
export default async function SearchPage() {
  return <Shell><SearchClient /></Shell>;
}
