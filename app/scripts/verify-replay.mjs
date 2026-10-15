/**
 * Replay audit (engine 1.3.0, E37) — every loan in the database, folded
 * receipt by receipt from the STORED facts, must reconcile. Read-only.
 *
 *   node scripts/verify-replay.mjs
 *
 * A stored receipt is a fact and is never re-priced. What is checked:
 *   1 · every receipt's appropriation rows add up to its amount
 *   2 · folding every receipt leaves the principal the loan row shows
 *       (0 for closed / released; the original less principal received for active)
 *   3 · a loan's status agrees with its receipts' closes_loan flags
 *   4 · receipts taken under THIS engine (1.3.x) re-price to exactly their
 *       stored split — the drift check for the live rule
 *   5 · the position prices without throwing (dues as of today)
 */
import fs from "node:fs";
import pg from "pg";
import { schemeFromRow, buildEvents, chargeSnapshot, appropriationRows, splitFromRows, ENGINE_VERSION } from "../src/lib/loanstate.js";
import { openLoan, addCharge, applyPayment, applySplit, dues } from "../src/lib/engine.js";

pg.types.setTypeParser(1082, v => v);
const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
if (envPath) for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cx = await pool.connect();
await cx.query("SELECT set_config('app.entity_ids', 'ALL', false)");
const q = async (t, p) => (await cx.query(t, p)).rows;

const loans = await q(`SELECT sv.*, l.id, l.loan_no, l.principal_paise, l.disbursed_at::text AS d, l.status::text AS status,
                              s.code AS scheme_code, l.scheme_version_id AS svid
                         FROM loan l JOIN scheme_version sv ON sv.id=l.scheme_version_id JOIN scheme s ON s.id=sv.scheme_id
                        ORDER BY l.id`);
const slabs = await q(`SELECT * FROM scheme_slab`);
const receipts = await q(`SELECT id, loan_id, business_date::text AS business_date, amount_paise, closes_loan, seals_cycle, engine_version
                            FROM receipt ORDER BY business_date, id`);
const charges = await q(`SELECT id, loan_id, total_paise, added_at::date::text AS added_on FROM loan_charge WHERE removed_at IS NULL`);
const approps = await q(`SELECT receipt_id, bucket::text AS bucket, loan_charge_id AS "loanChargeId", amount_paise AS "amountPaise" FROM receipt_appropriation ORDER BY id`);
const group = (rows, k) => rows.reduce((m, r) => ((m[r[k]] ??= []).push(r), m), {});
const recBy = group(receipts, "loan_id"), chgBy = group(charges, "loan_id"), apBy = group(approps, "receipt_id");
const today = (await q(`SELECT CURRENT_DATE::text AS d`))[0].d;
const liveMajorMinor = ENGINE_VERSION.split(".").slice(0, 2).join(".");

const problems = [];
let nLoans = 0, nReceipts = 0, nRepriced = 0, penalToday = 0, penalLoans = 0, interestToday = 0;
const byVersion = {};
for (const l of loans) {
  nLoans++;
  try {
    const scheme = schemeFromRow(l, slabs.filter(s => Number(s.scheme_version_id) === Number(l.svid)), l.scheme_code);
    const state = openLoan({ principal: Number(l.principal_paise) / 100, disbursedAt: l.d });
    const recs = (recBy[l.id] || []).map(r => ({ ...r, appropriation: apBy[r.id] || [] }));
    let principalReceived = 0, closedByReceipt = false;
    for (const ev of buildEvents(chgBy[l.id] || [], recs)) {
      if (ev.type === "charge") { addCharge(state, { id: ev.id, amount: ev.amount }); continue; }
      nReceipts++;
      const row = recs.find(r => r.business_date === ev.date && !r._used && Number(r.amount_paise) === ev.amountPaise);
      if (row) row._used = true;
      byVersion[row?.engine_version ?? "?"] = (byVersion[row?.engine_version ?? "?"] || 0) + 1;
      const sum = ev.rows.reduce((a, r) => a + Number(r.amountPaise), 0);
      if (sum !== ev.amountPaise) problems.push(`${l.loan_no} receipt ${row?.id} on ${ev.date}: split ${sum} ≠ amount ${ev.amountPaise}`);
      const d = dues(scheme, state, ev.date);
      // 4 · live-engine receipts must re-price to their stored split
      if (row && String(row.engine_version || "").startsWith(liveMajorMinor + ".")) {
        nRepriced++;
        const probe = structuredClone(state);
        const before = chargeSnapshot(probe);
        try {
          const { receipt } = applyPayment(scheme, probe, { date: ev.date, amount: ev.amountPaise / 100, closing: ev.closes });
          const want = ev.rows.map(a => `${a.bucket}:${a.loanChargeId ?? ""}:${a.amountPaise}`).sort().join(" ");
          const got = appropriationRows(before, probe, receipt).map(a => `${a.bucket}:${a.loanChargeId ?? ""}:${a.amountPaise}`).sort().join(" ");
          if (want !== got) problems.push(`${l.loan_no} receipt ${row.id} on ${ev.date} (${row.engine_version}): stored [${want}] ≠ re-priced [${got}]`);
          if (!!receipt.sealsCycle !== !!ev.seals) problems.push(`${l.loan_no} receipt ${row.id}: seals_cycle ${ev.seals} but engine says ${!!receipt.sealsCycle}`);
        } catch (e) { problems.push(`${l.loan_no} receipt ${row.id}: re-pricing threw — ${e.message}`); }
      }
      const split = splitFromRows(state, ev.rows);
      principalReceived += split.principal;
      applySplit(scheme, state, { date: ev.date, d, split, seals: ev.seals, closes: ev.closes });
      if (ev.closes) closedByReceipt = true;
    }
    const isActive = l.status === "active";
    if (isActive && closedByReceipt) problems.push(`${l.loan_no}: active but a receipt says closes_loan`);
    if (!isActive && !closedByReceipt && l.status !== "closed_by_renewal" && recs.length > 0 && state.principal > 0)
      problems.push(`${l.loan_no}: ${l.status} yet principal ${state.principal} remains and no receipt closes it`);
    if (Number(l.principal_paise) - principalReceived !== state.principal)
      problems.push(`${l.loan_no}: principal ${state.principal} ≠ original − received (${Number(l.principal_paise) - principalReceived})`);
    if (isActive) {
      const p = dues(scheme, state, today)._paise;
      penalToday += p.penalDue; if (p.penalDue) penalLoans++; interestToday += p.interestDue;
    }
  } catch (e) { problems.push(`${l.loan_no}: fold threw — ${e.message}`); }
}
console.log(`folded ${nLoans} loans · ${nReceipts} receipts (by engine version: ${Object.entries(byVersion).map(([k, v]) => `${k}=${v}`).join(", ")}) · re-priced ${nRepriced} live-engine receipt(s)`);
console.log(`running loans today: interest due ₹${(interestToday / 100).toLocaleString("en-IN")} · penal due ₹${(penalToday / 100).toLocaleString("en-IN")} on ${penalLoans} loan(s)`);
for (const p of problems.slice(0, 40)) console.log("PROBLEM " + p);
console.log(problems.length ? `\nREPLAY AUDIT FAIL — ${problems.length} problem(s)` : "\nREPLAY AUDIT PASS — every stored receipt reconciles");
cx.release(); await pool.end();
process.exit(problems.length ? 1 : 0);
