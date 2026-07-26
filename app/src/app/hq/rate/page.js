import { redirect } from "next/navigation";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q, one } from "@/lib/db.js";
import RateClient from "./RateClient.js";
export const dynamic = "force-dynamic";

export default async function RatePage() {
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  const mayMake  = can(actor, "rate_maker",  { need: "full" }).ok;
  const mayCheck = can(actor, "rate_checker", { need: "full" }).ok;
  if (!mayMake && !mayCheck) redirect("/home");

  const published = await one(
    `SELECT dr.base_paise, dr.published_at, m.full_name AS maker, c.full_name AS checker
       FROM daily_rate dr JOIN employee m ON m.id = dr.maker_id JOIN employee c ON c.id = dr.checker_id
      WHERE dr.rate_date = CURRENT_DATE AND dr.metal_id = 1`);
  const draft = await one(
    `SELECT rd.base_paise, rd.created_at, e.full_name AS maker, rd.maker_id
       FROM rate_draft rd JOIN employee e ON e.id = rd.maker_id
      WHERE rd.rate_date = CURRENT_DATE AND rd.metal_id = 1`);
  const purities = await q(
    `SELECT karat, purity_pct FROM purity WHERE metal_id = 1 AND active ORDER BY purity_pct DESC`);
  const history = await q(
    `SELECT dr.rate_date, dr.base_paise, m.full_name AS maker, c.full_name AS checker
       FROM daily_rate dr JOIN employee m ON m.id = dr.maker_id JOIN employee c ON c.id = dr.checker_id
      WHERE dr.metal_id = 1 ORDER BY dr.rate_date DESC LIMIT 10`);

  return <RateClient
    me={{ id: actor.employeeId, name: actor.fullName, mayMake, mayCheck }}
    published={published} draft={draft} purities={purities} history={history} />;
}
