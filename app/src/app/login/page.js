import { one } from "@/lib/db.js";
import LoginClient from "./LoginClient.js";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // the sign-in screen tells staff the state of the day before they even log in
  // E34 (owner, 15 Oct 2026): the one rate the application quotes is the FUNDING rate
  const r = await one(`SELECT coalesce(funding_paise, base_paise) AS funding_paise, published_at FROM rate_in_force(1, CURRENT_DATE)`)
    .catch(() => null);
  const rate = r ? {
    display: "₹" + Math.round(r.funding_paise / 100).toLocaleString("en-IN") + "/g",
    at: "in force",
  } : null;
  return <LoginClient rate={rate} />;
}
