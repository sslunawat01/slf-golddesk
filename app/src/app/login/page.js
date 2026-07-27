import { one } from "@/lib/db.js";
import LoginClient from "./LoginClient.js";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // the sign-in screen tells staff the state of the day before they even log in
  const r = await one(`SELECT base_paise, published_at FROM rate_in_force(1, CURRENT_DATE)`)
    .catch(() => null);
  const rate = r ? {
    display: "₹" + Math.round(r.base_paise / 100).toLocaleString("en-IN") + "/g",
    at: "in force",
  } : null;
  return <LoginClient rate={rate} />;
}
