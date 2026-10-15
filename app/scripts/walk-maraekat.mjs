/**
 * Walk: the Maraekat test-data import, seen through the APPLICATION (API layer).
 * Run after `import-maraekat.mjs --commit`, TWICE. Read-only except step 9,
 * which takes one live ₹500 cash payment on an imported running loan (the
 * purge must remove it too).
 *
 *   node scripts/walk-maraekat.mjs
 */
import pg from "pg";
import { schemeFromRow, replayLoan } from "../src/lib/loanstate.js";
import { dues } from "../src/lib/engine.js";
pg.types.setTypeParser(1082, v => v);
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" });
const sql = async (t, p) => (await pool.query(t, p)).rows;
const sql1 = async (t, p) => (await sql(t, p))[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
async function call(path, body, cookie, method = body == null ? "GET" : "POST") {
  const r = await fetch(BASE + path, { method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text, setCookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
async function loginAt(username, branchId) {
  const a = await call("/api/auth/login", { username, password: "Testpass123456" });
  let c = a.setCookie;
  if (a.j?.next === "branch") c = (await call("/api/auth/branch", { ticket: a.j.ticket, branchId })).setCookie;
  const s = await call("/api/auth/branch", { branchId }, c);
  return s.setCookie || c;
}

const maker = await sql1(`SELECT id FROM employee WHERE emp_code='MRK-IMP-M'`);
ok(!!maker, "import employees present");
const B3 = Number((await sql1(`SELECT id FROM branch WHERE code='03'`)).id);
const own = await loginAt("slunawat", B3);
ok(!!own, "owner signed in at B3");

// ═════ 1 · the import employees cannot sign in ═════
const li = await call("/api/auth/login", { username: "maraekat.import.maker", password: "x" });
ok(li.status >= 400 && li.status < 500 && !li.setCookie.startsWith("slf"), `import maker cannot sign in (got ${li.status})`);

// ═════ 2 · search finds imported customers by name, mobile, customer and loan number ═════
// (search lists RUNNING loans only, and matches the name as typed in full — product behaviour)
const c1 = await sql1(`SELECT c.id, c.cust_no, c.full_name, c.mobile, l.loan_no FROM customer c
    JOIN loan l ON l.customer_id=c.id AND l.status='active'
   WHERE c.created_by=$1 ORDER BY c.id LIMIT 1`, [maker.id]);
for (const term of [c1.mobile, c1.cust_no, c1.loan_no, c1.full_name]) {
  const s = await call(`/api/search?q=${encodeURIComponent(term)}`, null, own);
  const hit = (s.j?.customers || []).some(x => x.custNo === c1.cust_no) || (s.j?.loans || []).some(x => x.loanNo === c1.loan_no);
  ok(s.status === 200 && hit, `search "${term}" finds ${c1.cust_no}`);
}

// ═════ 3 · every running imported loan prices on the collect screen exactly as a direct engine replay ═════
// (E31: the expected figure is computed here from the database rows — NOT read from the
//  import report, which was priced on the day of the import and under that day's engine)
const act = await sql(`SELECT sv.*, l.id, l.loan_no, l.principal_paise, l.disbursed_at::text AS d, s.code AS scheme_code,
                              l.scheme_version_id AS svid
                         FROM loan l JOIN scheme_version sv ON sv.id=l.scheme_version_id JOIN scheme s ON s.id=sv.scheme_id
                        WHERE l.created_by=$1 AND l.status='active' ORDER BY l.id`, [maker.id]);
const slabsAll = await sql(`SELECT * FROM scheme_slab`);
const today = (await sql1(`SELECT CURRENT_DATE::text AS d`)).d;
let mism = 0, bad = 0;
for (const l of act) {
  const scheme = schemeFromRow(l, slabsAll.filter(x => Number(x.scheme_version_id) === Number(l.svid)), l.scheme_code);
  const st = replayLoan({ principalPaise: l.principal_paise, disbursedAt: l.d, scheme,
    charges: await sql(`SELECT id, total_paise, added_at::date::text AS added_on FROM loan_charge WHERE loan_id=$1 AND removed_at IS NULL`, [l.id]),
    receipts: await sql(`SELECT business_date::text AS business_date, amount_paise, closes_loan, engine_version FROM receipt WHERE loan_id=$1 ORDER BY business_date, id`, [l.id]) });
  const want = dues(scheme, st, today)._paise.settlement;
  const d = await call(`/api/loans/${l.id}/dues`, null, own);
  const s = d.j?.running?._paise?.settlement;
  if (d.status !== 200) { bad++; if (bad < 4) console.log("   dues", l.loan_no, d.status, d.text.slice(0, 120)); continue; }
  if (Number(s) !== want) { mism++; if (mism < 4) console.log("   differs", l.loan_no, s, want); }
}
ok(bad === 0, `collect screen loads for all ${act.length} running imported loans (${bad} failed)`);
ok(mism === 0, `collect-screen settlement equals a direct engine replay on every loan (${mism} differ)`);

// ═════ 4 · reports run over the imported book ═════
const out = await call(`/api/reports/outstanding?branch=${B3}`, null, own);
const outRows = out.j?.rows?.length ?? out.j?.loans?.length;
ok(out.status === 200 && outRows >= act.length, `Outstanding report: ${outRows} B3 loans (≥ ${act.length} imported)`);
for (const fy of ["2024-25", "2025-26", "2026-27"]) {
  const s = await call(`/api/reports/summary?branch=${B3}&fy=${fy}`, null, own);
  ok(s.status === 200 && s.j?.ok !== false, `Summary report FY ${fy} (${s.status})`);
}
const db = await call(`/api/reports/daybook?branch=${B3}&date=2025-10-29`, null, own);
ok(db.status === 200 && db.j?.ok !== false, `Day book for an imported day 29-10-2025 (${db.status})`);
const rp = await call(`/api/reports/repay?branch=${B3}&fy=2025-26`, null, own);
ok(rp.status === 200 && rp.j?.ok !== false, `Repayments report FY 2025-26 (${rp.status})`);
const lg = await call(`/api/reports/ledger?branch=${B3}&fy=2025-26`, null, own);
ok(lg.status === 200 && lg.j?.ok !== false, `Ledger report FY 2025-26 (${lg.status})`);
const ah = await call(`/api/reports/apphistory?branch=${B3}&fy=2025-26`, null, own);
ok(ah.status === 200 && ah.j?.ok !== false, `Application history FY 2025-26 (${ah.status})`);

// ═════ 5 · loan dossiers: running, released, renewed ═════
for (const st of ["active", "released", "closed_by_renewal"]) {
  const l = await sql1(`SELECT loan_no FROM loan WHERE created_by=$1 AND status=$2 ORDER BY id LIMIT 1`, [maker.id, st]);
  const d = await call(`/api/reports/loandetails?loanNo=${l.loan_no}`, null, own);
  ok(d.status === 200 && d.j?.loan?.status === st && d.j.items.length === 1 && d.j.history.length >= 3,
    `Loan Details ${l.loan_no} (${st}): ${d.j?.receipts?.length} receipts, ${d.j?.history?.length} history rows`);
}

// ═════ 6 · pages render ═════
const al = await sql1(`SELECT id, customer_id FROM loan WHERE created_by=$1 AND status='active' ORDER BY id LIMIT 1`, [maker.id]);
for (const p of [`/loans/${al.id}`, `/customers/${al.customer_id}`, `/vault`, `/overdue`, `/home`, `/repay/${al.id}`, `/release`]) {
  const r = await call(p, null, own);
  ok(r.status === 200 && !/Application error|Internal Server Error/i.test(r.text), `page ${p} renders (${r.status})`);
}

// ═════ 7 · vault shows the imported running packets in Safe M ═════
const v = await call(`/api/vault`, null, own);
ok(v.status === 200, `vault API (${v.status})`);
const inSafe = await sql1(`SELECT count(*)::int n FROM packet p JOIN loan l ON l.id=p.loan_id WHERE l.created_by=$1 AND p.status='in_safe'`, [maker.id]);
ok(inSafe.n === act.length, `${inSafe.n} packets in the safe = ${act.length} running loans`);

// ═════ 8 · overdue queue works with imported loans ═════
const od = await call(`/api/overdue`, null, own);
ok(od.status === 200 && od.j?.ok !== false, `overdue API (${od.status})`);

// ═════ 9 · a live ₹500 cash payment on an imported running loan ═════
const pay = await call(`/api/loans/${al.id}/receipt`, { mode: "cash", amountPaise: 50000 }, own);
ok(pay.j?.ok === true, `live payment on imported loan → ${pay.j?.receiptNo || pay.j?.reason}`);
const after = await call(`/api/loans/${al.id}/dues`, null, own);
ok(after.status === 200, "loan still prices after a live payment");

await pool.end();
console.log(failures === 0 ? "\nMARAEKAT WALK PASS" : `\nMARAEKAT WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
