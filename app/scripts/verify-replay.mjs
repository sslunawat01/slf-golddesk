/**
 * Replay audit — every loan in the database, replayed receipt by receipt
 * through the CURRENT engine (src/lib), must reproduce EXACTLY the
 * appropriation rows that were stored when each receipt was taken, and must
 * end in the status the loan row shows. Read-only. Prints a summary and the
 * first few mismatches; exit 1 on any.
 *
 *   node scripts/verify-replay.mjs
 *
 * Run it after every engine change (E31): old receipts carry their
 * engine_version and must replay under the rule they were priced with.
 */
import fs from "node:fs";
import pg from "pg";
import { schemeFromRow, buildEvents, chargeSnapshot, appropriationRows } from "../src/lib/loanstate.js";
import { openLoan, addCharge, applyPayment, dues } from "../src/lib/engine.js";

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
const receipts = await q(`SELECT id, loan_id, business_date::text AS business_date, amount_paise, closes_loan, engine_version
                            FROM receipt ORDER BY business_date, id`);
const charges = await q(`SELECT id, loan_id, total_paise, added_at::date::text AS added_on FROM loan_charge WHERE removed_at IS NULL`);
const approps = await q(`SELECT receipt_id, bucket::text AS bucket, loan_charge_id, amount_paise FROM receipt_appropriation`);
const group = (rows, k) => rows.reduce((m, r) => ((m[r[k]] ??= []).push(r), m), {});
const recBy = group(receipts, "loan_id"), chgBy = group(charges, "loan_id"), apBy = group(approps, "receipt_id");
const today = (await q(`SELECT CURRENT_DATE::text AS d`))[0].d;

const problems = [];
let nLoans = 0, nReceipts = 0, penalToday = 0, penalLoans = 0;
const byVersion = {};
for (const l of loans) {
  nLoans++;
  try {
    const scheme = schemeFromRow(l, slabs.filter(s => Number(s.scheme_version_id) === Number(l.svid)), l.scheme_code);
    const state = openLoan({ principal: Number(l.principal_paise) / 100, disbursedAt: l.d });
    const recs = recBy[l.id] || [];
    // stored rows are matched to events in order — two same-day receipts for
    // the same amount are different facts, so each key is a queue, not a slot
    const byKey = {};
    for (const r of recs) (byKey[`${r.business_date}|${r.amount_paise}|${r.closes_loan}`] ??= []).push(r);
    for (const ev of buildEvents(chgBy[l.id] || [], recs)) {
      if (ev.type === "charge") { addCharge(state, { id: ev.id, amount: ev.amount }); continue; }
      const before = chargeSnapshot(state);
      const { receipt } = applyPayment(scheme, state, ev);
      nReceipts++;
      // the stored split for THIS receipt (same date, amount, closes flag)
      const row = (byKey[`${ev.date}|${Math.round(ev.amount * 100)}|${ev.closing}`] || []).shift();
      byVersion[row?.engine_version ?? "?"] = (byVersion[row?.engine_version ?? "?"] || 0) + 1;
      const want = (apBy[row?.id] || []).map(a => `${a.bucket}:${a.loan_charge_id ?? ""}:${a.amount_paise}`).sort().join(" ");
      const got = appropriationRows(before, state, receipt).map(a => `${a.bucket}:${a.loanChargeId ?? ""}:${a.amountPaise}`).sort().join(" ");
      if (want !== got) problems.push(`${l.loan_no} receipt ${row?.id ?? "?"} on ${ev.date}: stored [${want}] ≠ replay [${got}]`);
      if (!!receipt.closing !== !!ev.closing) problems.push(`${l.loan_no} receipt on ${ev.date}: closes_loan ${ev.closing} but engine says ${!!receipt.closing}`);
    }
    const isActive = l.status === "active";
    if (isActive === state.closed) problems.push(`${l.loan_no}: status ${l.status} but engine closed=${state.closed}`);
    if (isActive) { const p = dues(scheme, state, today)._paise.penalDue; penalToday += p; if (p) penalLoans++; }
  } catch (e) { problems.push(`${l.loan_no}: replay threw — ${e.message}`); }
}
console.log(`replayed ${nLoans} loans · ${nReceipts} receipts (by engine version: ${Object.entries(byVersion).map(([k, v]) => `${k}=${v}`).join(", ")})`);
console.log(`penal due today on running loans: ₹${(penalToday / 100).toLocaleString("en-IN")} on ${penalLoans} loan(s)`);
for (const p of problems) console.log("PROBLEM " + p);
console.log(problems.length ? `\nREPLAY AUDIT FAIL — ${problems.length} problem(s)` : "\nREPLAY AUDIT PASS — every stored receipt reproduces exactly");
cx.release(); await pool.end();
process.exit(problems.length ? 1 : 0);
