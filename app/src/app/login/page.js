import { one } from "@/lib/db.js";
import LoginClient from "./LoginClient.js";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // the sign-in screen tells staff the state of the day before they even log in
  const r = await one(
    `SELECT base_paise, published_at FROM daily_rate
      WHERE rate_date = CURRENT_DATE AND metal_id = 1
      ORDER BY published_at DESC LIMIT 1`).catch(() => null);
  const rate = r ? {
    display: "₹" + Math.round(r.base_paise / 100).toLocaleString("en-IN") + "/g",
    at: new Date(r.published_at).toLocaleTimeString("en-IN",
        { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }),
  } : null;
  return <LoginClient rate={rate} />;
}
