import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session.js";
export const dynamic = "force-dynamic";
export default async function Root() {
  const actor = await currentActor();
  redirect(actor ? "/home" : "/login");
}
