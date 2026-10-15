/**
 * Walk: Reports section (E27) — API layer, with figures CROSS-CHECKED against
 * independent sources: the dues API (engine), raw SQL sums, and the signed
 * day-cycle. Run TWICE before packaging. UI layer: walk-reports-ui.mjs.
 */
import pg from "pg";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };

async function login(username, branchHint) {
  let r = await fetch(`${BASE}/api/auth/login`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "Testpass123456" }) });
  let cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const j = await r.json();
  if (j.next === "branch") {
    const r2 = await fetch(`${BASE}/api/auth/branch`, { method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ ticket: j.ticket, branchId: branchHint }) });   // E28: ticket, never a bare id
    cookie = (r2.headers.get("set-cookie") || "").split(";")[0] || cookie;
  } else if (branchHint && cookie) {
    // a returning multi-branch user RESUMES his last branch — move him to the
    // one this walk needs, through the session (the header-switch path)
    const r3 = await fetch(`${BASE}/api/auth/branch`, { method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ branchId: branchHint }) });
    cookie = (r3.headers.get("set-cookie") || "").split(";")[0] || cookie;
  }
  return cookie;
}
const get = (cookie, path) => fetch(BASE + path, { headers: { cookie } }).then(r => r.json());

const boss = await login("slunawat", 1);      // posted to all 11 branches
const pune = await login("snehal.k");         // posted to Pune only

// —— branch wall ——
const walled = await get(pune, "/api/reports/outstanding?branch=1");
ok(walled.ok === false && /not allotted/i.test(walled.reason), "Pune operator refused branch 1");
const puneAll = await get(pune, "/api/reports/outstanding?branch=all");
ok(puneAll.ok && puneAll.rows.every(r => r.branch.startsWith("25 ")), "Pune 'all my branches' = Pune only");
const puneCount = await sql1(`SELECT count(*)::int AS n FROM loan WHERE status='active' AND branch_id=11`);
ok(puneAll.rows.length === puneCount.n, `Pune row count ${puneAll.rows.length} == SQL ${puneCount.n}`);

// —— outstanding vs the collect screen's own engine figures ——
const out = await get(boss, "/api/reports/outstanding?branch=all");
const totalActive = await sql1(`SELECT count(*)::int AS n FROM loan WHERE status='active'`);
ok(out.ok && out.rows.length === totalActive.n, `outstanding rows ${out.rows.length} == all active ${totalActive.n}`);
// the dues API is acting-branch scoped, so cross-check with a BRANCH 1 loan
const b1 = await sql1(`SELECT id, loan_no FROM loan WHERE status='active' AND branch_id=1 ORDER BY id LIMIT 1`);
const duesB1 = await get(boss, `/api/loans/${b1.id}/dues`).catch(() => null);
const rowB1 = out.rows.find(r => r.loanNo === b1.loan_no);
if (duesB1?.ok && rowB1) {
  ok(rowB1.interestPaise === duesB1.running._paise.interestDue,
    `${b1.loan_no} interest ${rowB1.interestPaise} == dues API ${duesB1.running._paise.interestDue}`);
  ok(rowB1.penalPaise === duesB1.running._paise.penalDue, `${b1.loan_no} penal matches dues API`);
  // E27b: principal must ALSO match the dues API — the ×100 hole never reopens
  ok(rowB1.principalPaise === Math.round(duesB1.running.principal * 100),
    `${b1.loan_no} principal ${rowB1.principalPaise} == dues API ${Math.round(duesB1.running.principal * 100)}`);
} else ok(false, `${b1.loan_no} present in both report and dues API`);

// —— repay register: every receipt's split must sum to its amount ——
const rep = await get(boss, "/api/reports/repay?fy=2026-27&branch=all");
ok(rep.ok && rep.rows.length > 0, `repay register has rows (${rep.rows?.length})`);
const badSplit = (rep.rows || []).filter(r =>
  r.chargePaise + r.roundingPaise + r.penalPaise + r.interestPaise + r.principalPaise !== r.amountPaise);
ok(badSplit.length === 0, `every split sums to its amount (${badSplit.length} bad)`);
const repSql = await sql1(`SELECT coalesce(sum(amount_paise),0)::bigint AS s, count(*)::int AS n
  FROM receipt WHERE business_date BETWEEN '2026-04-01' AND '2027-03-31'`);
ok(rep.rows.length === repSql.n &&
   rep.rows.reduce((a, r) => a + r.amountPaise, 0) === Number(repSql.s),
   `repay totals match SQL (${rep.rows.length} rows, ₹${Number(repSql.s) / 100})`);

// —— summary: FY disbursement counts vs SQL ——
const sum = await get(boss, "/api/reports/summary?fy=2026-27&branch=all");
const dSql = await sql1(`SELECT count(*)::int AS n, coalesce(sum(principal_paise),0)::bigint AS p
  FROM loan WHERE disbursed_at BETWEEN '2026-04-01' AND '2027-03-31'`);
ok(sum.ok && sum.rows.reduce((a, r) => a + r.disbursedCount, 0) === dSql.n,
  `summary disbursed count == SQL ${dSql.n}`);
ok(sum.rows.reduce((a, r) => a + r.disbursedPaise, 0) === Number(dSql.p),
  "summary disbursed ₹ == SQL");
ok(sum.rows.reduce((a, r) => a + r.activeCount, 0) === totalActive.n,
  "summary active count == all active");
// E27b: period-end book == the live engine book, branch by branch
ok(sum.rows.every(r => r.osEndPaise === r.activePrincipalPaise),
  "summary: O/s at period end == live Principal O/s (every branch)");

// —— apphistory count vs SQL ——
const ah = await get(boss, "/api/reports/apphistory?fy=2026-27&branch=all");
const ahSql = await sql1(`SELECT count(*)::int AS n FROM loan_state_history h
  JOIN loan_application a ON a.id=h.application_id
  WHERE h.at::date BETWEEN '2026-04-01' AND '2027-03-31'`);
ok(ah.ok && ah.rows.length === ahSql.n, `apphistory rows ${ah.rows.length} == SQL ${ahSql.n}`);

// —— daybook 28 Aug, branch 1: must tie to the signed day-cycle ——
const db28 = await get(boss, "/api/reports/daybook?branch=1&date=2026-08-28");
ok(db28.ok && db28.day, "daybook 28 Aug loads with a signed day");
if (db28.ok && db28.day) {
  ok(db28.day.openingPaise === 18450000, `opening ₹1,84,500 (got ${db28.day.openingPaise})`);
  ok(db28.closingCashPaise === db28.day.endCountedPaise,
    `live closing ${db28.closingCashPaise} == signed day-end ${db28.day.endCountedPaise}`);
}

// —— ledger: double-entry must balance to the paisa ——
const led = await get(boss, "/api/reports/ledger?fy=2026-27&branch=all");
if (led.ok) {
  const dr = led.summary.reduce((a, s) => a + s.drPaise, 0);
  const cr = led.summary.reduce((a, s) => a + s.crPaise, 0);
  ok(dr === cr, `ledger balances: ΣDr ${dr} == ΣCr ${cr}`);
  const cash = led.summary.find(s => s.head === "Cash in hand");
  const cashSql = await sql1(`SELECT
    (SELECT coalesce(sum(amount_paise),0) FROM receipt WHERE mode='cash'
      AND business_date BETWEEN '2026-04-01' AND '2027-03-31')::bigint AS din,
    ((SELECT coalesce(sum(dl.amount_paise),0) FROM disbursement_leg dl
       JOIN disbursement d ON d.id=dl.disbursement_id
      WHERE dl.kind='cash' AND d.created_at::date BETWEEN '2026-04-01' AND '2027-03-31')
     + (SELECT coalesce(sum(amount_paise),0) FROM cash_transfer
         WHERE created_at::date BETWEEN '2026-04-01' AND '2027-03-31'))::bigint AS dout`);
  ok(cash && cash.drPaise === Number(cashSql.din) && cash.crPaise === Number(cashSql.dout),
    `Cash head Dr/Cr == SQL (${cash?.drPaise}/${cash?.crPaise} vs ${cashSql.din}/${cashSql.dout})`);
  const det = await get(boss, "/api/reports/ledger?fy=2026-27&branch=all&head=Interest income");
  ok(det.ok && Array.isArray(det.detail), `Interest income drill-down returns entries (${det.detail?.length})`);
} else ok(false, "ledger loads");

// —— loan details dossier ——
const dd = await get(boss, "/api/reports/loandetails?loanNo=25L262700001");
ok(dd.ok && dd.loan.loanNo === "25L262700001" && dd.position, "dossier loads with live position");
const recCount = await sql1(`SELECT count(*)::int AS n FROM receipt WHERE loan_id=30`);
ok(dd.receipts.length === recCount.n, `dossier receipts ${dd.receipts.length} == SQL ${recCount.n}`);
const ddWalled = await get(pune, "/api/reports/loandetails?loanNo=01A6702302");
ok(ddWalled.ok === false && /not a branch allotted/i.test(ddWalled.reason || ""),
  "dossier refuses a loan outside the user's branches");

await pool.end();
console.log(failures === 0 ? "\nREPORTS API WALK PASS" : `\nWALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
