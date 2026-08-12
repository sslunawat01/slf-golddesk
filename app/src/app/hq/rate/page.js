import Shell from "@/components/Shell.js";
import { currentActor } from "@/lib/session.js";
import { can } from "@/lib/policy.js";
import { q, one } from "@/lib/db.js";
import { rateLabel } from "@/lib/rate.js";
import { redirect } from "next/navigation";
import RateClient from "./RateClient.js";
export const dynamic = "force-dynamic";

export default async function RatePage({ searchParams }) {
  const sp = await searchParams;
  const actor = await currentActor();
  if (!actor) redirect("/login?expired=1");
  const mayPublish = can(actor, "rate_maker", { need: "full" }).ok;
  if (!mayPublish && !can(actor, "reports", { need: "view" }).ok) redirect("/home");

  const today = new Date().toISOString().slice(0, 10);
  const metals = await q(
    `SELECT id, kind::text, enabled, valued_as_pct_of_gold FROM metal ORDER BY id`);
  const ownPair = metals.filter(m => !m.valued_as_pct_of_gold);
  const mid = ownPair.some(m => Number(m.id) === Number(sp?.metal))
    ? Number(sp.metal) : Number(ownPair[0]?.id ?? 1);
  const selected = metals.find(m => Number(m.id) === mid);
  const inForce = await one(`SELECT * FROM rate_in_force($1, CURRENT_DATE)`, [mid]);
  const setter = inForce ? await one(`SELECT full_name FROM employee WHERE id=$1`, [inForce.maker_id]) : null;
  const purities = await q(
    `SELECT karat, purity_pct FROM purity WHERE metal_id=$1 AND active ORDER BY purity_pct DESC`, [mid]);
  const history = await q(
    `SELECT dr.rate_date, dr.base_paise, dr.funding_paise, dr.jump_pct, dr.jump_confirmed,
            e.full_name AS setter
       FROM daily_rate dr JOIN employee e ON e.id = dr.maker_id
      WHERE dr.metal_id = $1 ORDER BY dr.rate_date DESC LIMIT 12`, [mid]);
  const warnPct = Number((await one(`SELECT value FROM app_setting WHERE key='rate_jump_warn_pct'`))?.value ?? 5);

  return (
    <Shell title="Daily rate">
      <RateClient
        mayPublish={mayPublish}
        metals={metals.map(m => ({ id: Number(m.id), kind: m.kind, enabled: m.enabled,
          linked: m.valued_as_pct_of_gold }))}
        metalId={mid}
        metalName={selected ? selected.kind[0].toUpperCase() + selected.kind.slice(1) : "Gold"}
        inForce={inForce ? { basePaise: Number(inForce.base_paise),
          fundingPaise: Number(inForce.funding_paise ?? inForce.base_paise),
          rateDate: inForce.rate_date, setter: setter?.full_name || "—" } : null}
        label={rateLabel(inForce?.rate_date ?? null, today)}
        purities={purities.map(p => ({ karat: p.karat, pct: Number(p.purity_pct) }))}
        history={history.map(h => ({ ...h, base_paise: Number(h.base_paise),
          funding_paise: Number(h.funding_paise ?? h.base_paise),
          jump_pct: h.jump_pct === null ? null : Number(h.jump_pct) }))}
        warnPct={warnPct} />
    </Shell>);
}
