/**
 * SLF GoldDesk — expected-figures sheet for the Pune calculation test-bed.
 * Replays every branch-11 loan exactly the way the Loan Profile does
 * (schemeFromRow → replayLoan → dues as of CURRENT_DATE) and prints what the
 * browser MUST show today. Run after seed-pune-tests.mjs, and again on any
 * later day — the figures move with the calendar, the sheet stays truthful.
 *   node scripts/verify-pune-tests.mjs
 */
import fs from "node:fs";
import pg from "pg";
import { dues } from "../src/lib/engine.js";
import { schemeFromRow, replayLoan } from "../src/lib/loanstate.js";

const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const rupees = (r) => "₹" + Number(r).toLocaleString("en-IN");

const { rows: [{ d: today }] } = await pool.query("SELECT CURRENT_DATE::text AS d");
const { rows: loans } = await pool.query(
  `SELECT l.id, l.loan_no, l.principal_paise, l.disbursed_at, l.status::text,
          l.scheme_version_id, c.full_name, c.cust_no,
          (SELECT h.note FROM loan_state_history h
            WHERE h.loan_id = l.id AND h.note LIKE '%SEED CASE%' LIMIT 1) AS seed_note
     FROM loan l JOIN customer c ON c.id = l.customer_id
    WHERE l.branch_id = 11 ORDER BY l.loan_no`);
if (!loans.length) { console.log("No loans on branch 11 — seed first."); process.exit(1); }

console.log(`\nPUNE CALCULATION TEST-BED — expected figures as of ${today}`);
console.log("=".repeat(96));
for (const l of loans) {
  const { rows: [sv] } = await pool.query(
    `SELECT sv.*, s.code AS scode, s.name AS sname FROM scheme_version sv
       JOIN scheme s ON s.id = sv.scheme_id WHERE sv.id = $1`, [l.scheme_version_id]);
  const { rows: slabs } = await pool.query(
    `SELECT * FROM scheme_slab WHERE scheme_version_id = $1`, [l.scheme_version_id]);
  const scheme = schemeFromRow(sv, slabs, sv.scode);
  const { rows: charges } = await pool.query(
    `SELECT id, total_paise, added_at::date::text AS added_on FROM loan_charge
      WHERE loan_id = $1 AND removed_at IS NULL ORDER BY added_at`, [l.id]);
  const { rows: receipts } = await pool.query(
    `SELECT business_date::text AS date, amount_paise, closes_loan FROM receipt
      WHERE loan_id = $1 ORDER BY id`, [l.id]);

  const state = replayLoan({
    principalPaise: l.principal_paise, disbursedAt: l.disbursed_at, scheme,
    charges,                                   // id · total_paise · added_on, as buildEvents expects
    receipts: receipts.map(r => ({ business_date: r.date, amount_paise: r.amount_paise,
                                   closes_loan: r.closes_loan })),
  });
  const d = dues(scheme, state, today);

  const tag = (l.seed_note?.match(/SEED CASE (\w+): (.*)$/) || [null, "—", ""]);
  // R-L (owner 28 Aug 2026): both end days count — disbursement day is day 1
  const age = Math.round((Date.parse(today) - Date.parse(l.disbursed_at)) / 86400000) + 1;
  console.log(`\n[${tag[1]}]  ${l.loan_no}  ·  ${l.full_name} (${l.cust_no})`);
  console.log(`     ${tag[2]}`);
  console.log(`     scheme ${sv.scode} “${sv.sname}” v${sv.version_no} · disbursed ${l.disbursed_at} (day ${age} today)`);
  if (receipts.length)
    console.log(`     receipts: ${receipts.map(r => `${r.date} ${rupees(r.amount_paise / 100)}`).join(" · ")}`);
  console.log(`     Principal O/S ${rupees(d.principal)}   Interest ${rupees(d.interest.due)}` +
    (d.interest.minApplied ? "  (15-day floor applied)" : "") +
    `   Penal ${rupees(d.penal.due)}` +
    (d.penal.inGraceWindow ? `  (in grace till ${d.penal.graceTill})` : d.penal.days ? `  (${d.penal.days} days)` : "") +
    `   Charges ${rupees(d.charges.due)}`);
  console.log(`     Working: ${d.interest.workLine}   →  SETTLEMENT ${rupees(d.settlement)}`);
}
console.log("\n" + "=".repeat(96));
console.log("Open each loan in the browser (search the loan number) and compare every figure above.");
await pool.end();
