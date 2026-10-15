/**
 * E37 — what the rule change does to the running book: interest due today on every
 * active loan under engine 1.2.0 (re-priced replay, frozen copy) vs engine 1.3.0 (facts
 * folded, part payments buy days). Read-only. Writes a CSV beside the summary.
 *   node scripts/compare-engine-1.2-vs-1.3.mjs [out.csv]
 */
import fs from "node:fs";
import pg from "pg";
import * as OLD from "./engine-1.2.0-frozen.js";
import * as OLDL from "./loanstate-1.2.0-frozen.js";
import * as NEW from "../src/lib/engine.js";
import * as NEWL from "../src/lib/loanstate.js";
pg.types.setTypeParser(1082, v => v);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" });
const q = async (t, p) => (await pool.query(t, p)).rows;
await q("SELECT set_config('app.entity_ids','ALL',false)");
const today = (await q(`SELECT CURRENT_DATE::text AS d`))[0].d;
const loans = await q(`SELECT sv.*, l.id, l.loan_no, l.principal_paise, l.disbursed_at::text AS d, s.code AS scheme_code, l.scheme_version_id AS svid,
                              c.full_name AS customer, b.code AS branch
                         FROM loan l JOIN scheme_version sv ON sv.id=l.scheme_version_id JOIN scheme s ON s.id=sv.scheme_id
                         JOIN customer c ON c.id=l.customer_id JOIN branch b ON b.id=l.branch_id WHERE l.status='active' ORDER BY l.id`);
const slabs = await q(`SELECT * FROM scheme_slab`);
const charges = await q(`SELECT id, loan_id, total_paise, added_at::date::text AS added_on FROM loan_charge WHERE removed_at IS NULL`);
const rows = [];
let totOld = 0, totNew = 0, changed = 0, up = 0, down = 0;
for (const l of loans) {
  const sl = slabs.filter(s => Number(s.scheme_version_id) === Number(l.svid));
  const chg = charges.filter(c => Number(c.loan_id) === Number(l.id));
  const recs = await q(NEWL.RECEIPTS_FOR_REPLAY_SQL, [l.id]);
  let oldDue = null, newDue = null, cov = null;
  try {
    const so = OLDL.schemeFromRow(l, sl, l.scheme_code);
    const sto = OLDL.replayLoan({ principalPaise: l.principal_paise, disbursedAt: l.d, scheme: so, charges: chg, receipts: recs });
    oldDue = OLD.dues(so, sto, today)._paise.interestDue;
  } catch (e) { oldDue = NaN; }
  try {
    const sn = NEWL.schemeFromRow(l, sl, l.scheme_code);
    const stn = NEWL.replayLoan({ principalPaise: l.principal_paise, disbursedAt: l.d, scheme: sn, charges: chg, receipts: recs });
    newDue = NEW.dues(sn, stn, today)._paise.interestDue; cov = NEW.interestCoverage(sn, stn, today);
  } catch (e) { newDue = NaN; }
  if (Number.isFinite(oldDue)) totOld += oldDue; if (Number.isFinite(newDue)) totNew += newDue;
  const diff = (Number.isFinite(oldDue) && Number.isFinite(newDue)) ? newDue - oldDue : NaN;
  if (Math.abs(diff) >= 1000) { changed++; if (diff > 0) up++; else down++; }
  rows.push({ loan: l.loan_no, branch: l.branch, customer: l.customer, scheme: l.scheme_code, principal: l.principal_paise / 100,
    receipts: recs.length, partPaidDays: cov ? cov.paidDays : "", paidUpTo: cov ? cov.paidUpTo : "", unpaidDays: cov ? cov.dueDays : "",
    rate: cov ? cov.ratePct : "", oldDue: oldDue / 100, newDue: newDue / 100, diff: diff / 100 });
}
rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
const out = process.argv[2] || "engine-1.2-vs-1.3.csv";
const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cols = ["loan", "branch", "customer", "scheme", "principal", "receipts", "partPaidDays", "paidUpTo", "unpaidDays", "rate", "oldDue", "newDue", "diff"];
fs.writeFileSync(out, "﻿" + [cols.join(",")].concat(rows.map(r => cols.map(c => esc(typeof r[c] === "number" ? Math.round(r[c] * 100) / 100 : r[c])).join(","))).join("\n"));
console.log(`active loans ${loans.length} · interest due today: engine 1.2.0 ₹${Math.round(totOld / 100).toLocaleString("en-IN")} → engine 1.3.0 ₹${Math.round(totNew / 100).toLocaleString("en-IN")} (${Math.round((totNew - totOld) / 100).toLocaleString("en-IN")})`);
console.log(`loans whose due moves by ₹10 or more: ${changed} (${down} lower, ${up} higher) · written ${out}`);
for (const r of rows.slice(0, 10)) console.log(`${r.loan} ₹${r.principal} ${r.scheme} · bought ${Number(r.partPaidDays || 0).toFixed(2)}d · unpaid ${Number(r.unpaidDays || 0).toFixed(2)}d @${r.rate}% · ₹${r.oldDue} → ₹${r.newDue} (${r.diff > 0 ? "+" : ""}${r.diff})`);
await pool.end();
