/**
 * Walk: E34 — the FUNDING rate is the only rate the application quotes (owner, 15 Oct 2026). Run TWICE.
 *  Publishes a gold pair with a visible haircut (12,300 / 11,290), checks every server-rendered
 *  screen and API, then restores 12,300 / 12,300 so the other walks' fixtures hold.
 *  (Client-rendered screens — Metals tab, rate-board reckoner, Loan Details columns — are in walk-e34-ui.)
 */
import pg from "pg";
pg.types.setTypeParser(1082, v => v);
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || "postgres://slf:slf@localhost:5432/golddesk" });
const sql = async (t, p) => (await pool.query(t, p)).rows;
const sql1 = async (t, p) => (await sql(t, p))[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
async function call(path, body, cookie, method = body == null ? "GET" : "POST") {
  const r = await fetch(BASE + path, { method, redirect: "manual",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, j, text };
}
async function loginAt(username, branchId) {
  const a = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "Testpass123456" }) });
  const j = await a.json(); let c = (a.headers.get("set-cookie") || "").split(";")[0];
  if (j.next === "branch") {
    const b = await fetch(BASE + "/api/auth/branch", { method: "POST", headers: { "content-type": "application/json", cookie: c },
      body: JSON.stringify({ ticket: j.ticket, branchId }) });
    c = (b.headers.get("set-cookie") || "").split(";")[0];
  }
  const s = await fetch(BASE + "/api/auth/branch", { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ branchId }) });
  return (s.headers.get("set-cookie") || "").split(";")[0] || c;
}
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const own = await loginAt("slunawat", 3);
// the pair to restore at the end: the last one published BEFORE today (today's rows are this walk's own)
const before = await sql1(`SELECT base_paise, funding_paise FROM daily_rate WHERE metal_id=1 AND rate_date < CURRENT_DATE ORDER BY rate_date DESC, published_at DESC LIMIT 1`);
const already = (r) => r.j?.ok === true || (r.status === 409 && /already today/i.test(r.j?.reason || ""));

// ═════ 1 · the rate board still takes BOTH and enforces funding ≤ market ═════
const bad = await call("/api/rate", { marketRupees: 12300, fundingRupees: 12400, confirmed: true, metalId: 1 }, own);
ok(bad.status === 400 && /cannot be above the market/i.test(bad.j?.reason || ""), `funding above market refused: ${bad.j?.reason}`);
const pub = await call("/api/rate", { marketRupees: 12300, fundingRupees: 11290, confirmed: true, metalId: 1 }, own);
ok(already(pub), `published gold 12,300 market / 11,290 funding (${pub.status} ${pub.j?.reason || "ok"})`);
// O-A closed: a second publish on the same day is a correction row, not a 500
const corr = await call("/api/rate", { marketRupees: 12300, fundingRupees: 11300, confirmed: true, metalId: 1 }, own);
ok(corr.j?.ok === true, `same-day correction to 11,300 accepted (${corr.status} ${corr.j?.reason || "ok"})`);
const corr2 = await call("/api/rate", { marketRupees: 12300, fundingRupees: 11290, confirmed: true, metalId: 1 }, own);
ok(already(corr2), `…and back to 11,290 (${corr2.status})`);
const todayRows = await sql1(`SELECT count(*)::int n FROM daily_rate WHERE metal_id=1 AND rate_date=CURRENT_DATE`);
ok(todayRows.n >= 3, `every publish of the day is kept as its own row (${todayRows.n} today) — nothing deleted`);
const board = await call("/hq/rate", null, own);
ok(board.status === 200 && /corrected later that day/.test(board.text), "the rate board marks the superseded rows");
const rf = await sql1(`SELECT base_paise, funding_paise FROM rate_in_force(1, CURRENT_DATE)`);
ok(Number(rf.base_paise) === 1230000 && Number(rf.funding_paise) === 1129000, "rate in force carries both figures");

// ═════ 2 · the login screen quotes the funding rate ═════
const login = await call("/login", null, null);
ok(login.status === 200 && /11,290/.test(login.text) && !/12,300/.test(login.text) && /funding rate/i.test(login.text), "login page shows ₹11,290/g as the funding rate, not the market ₹12,300");

// ═════ 3 · HQ approvals: no market value ═════
const appr = await call("/hq/approvals", null, own);
ok(appr.status === 200 && !/Market value/i.test(appr.text) && /Funding value/i.test(appr.text), "HQ approvals shows Funding value and no Market value");

// ═════ 4 · the appraisal note prints funding value per ornament ═════
const loan = await sql1(`SELECT l.id, l.application_id FROM loan l WHERE l.branch_id=3 AND EXISTS (SELECT 1 FROM appraisal_item ai WHERE ai.application_id=l.application_id) ORDER BY l.id LIMIT 1`);
const items = await sql(`SELECT funding_paise, market_paise FROM appraisal_item WHERE application_id=$1`, [loan.application_id]);
const fundTotal = items.reduce((s, r) => s + Number(r.funding_paise), 0), mktTotal = items.reduce((s, r) => s + Number(r.market_paise), 0);
const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
const print = await call(`/print/appraisal/${loan.id}`, null, own);
ok(print.status === 200 && /Funding value/.test(print.text) && !/Market value|Valuation:/.test(print.text), "appraisal note: 'Funding value' column, no 'Market value' / 'Valuation'");
ok(print.text.includes(inr(fundTotal)) && (mktTotal === fundTotal || !print.text.includes(inr(mktTotal))), `appraisal note total ${inr(fundTotal)} is the funding total${mktTotal !== fundTotal ? ` (market ${inr(mktTotal)} absent)` : ""}`);

// ═════ 5 · Loan Details API: funding only ═════
const ld = await call(`/api/reports/loandetails?loanNo=${encodeURIComponent((await sql1(`SELECT loan_no FROM loan WHERE id=$1`, [loan.id])).loan_no)}`, null, own);
ok(ld.j?.ok && ld.j.items.length > 0 && ld.j.items.every(i => typeof i.fundingPaise === "number" && !("marketPaise" in i)), `Loan Details items carry fundingPaise and no marketPaise (${ld.j?.items?.length} items)`);

// ═════ 6 · Settings · Metals API still hands the funding figure the tab multiplies ═════
const met = await call("/api/settings/metals", null, own);
const gold = met.j?.metals?.find(m => m.kind === "gold");
ok(gold?.rate?.fundingPaise === 1129000, `metals API: gold funding rate ₹11,290 (${gold?.rate?.fundingPaise})`);

// ═════ 7 · the valuation itself is unchanged: funding value = net × funding rate × purity × scheme % ═════
const { ornamentValue } = await import("../src/lib/valuation.js");
const v = ornamentValue({ grossMg: 10000, stoneMg: 0, purityPct: 92, base24kPaise: 1230000, funding24kPaise: 1129000, fundingPct: 70 });
ok(v.fundingPaise === 7280000 && v.rawFundingPaise === 7270760, `10 g 22K GL2070 at 11,290: ₹72,707.60 → ₹72,800 (${v.fundingPaise / 100})`);

// ═════ 8 · the wizard prices a fresh pledge off the funding rate ═════
const cust = await sql1(`SELECT c.id FROM customer c WHERE c.is_blacklisted = false AND c.kyc_done_at >= CURRENT_DATE - 1000 AND c.cust_no LIKE 'IND%'
  AND NOT EXISTS (SELECT 1 FROM loan l WHERE l.customer_id = c.id AND l.status = 'active')
  AND NOT EXISTS (SELECT 1 FROM loan_application la WHERE la.customer_id = c.id AND la.status NOT IN ('cancelled','activated')) ORDER BY c.id LIMIT 1`).catch(() => null);
if (cust) {
  const app = await call("/api/applications", { customerId: cust.id }, own);
  if (app.j?.ok) {
    const snap = await sql1(`SELECT base_paise, funding_paise FROM application_rate WHERE application_id=$1 AND metal_id=1`, [app.j.id]);
    ok(Number(snap?.funding_paise) === 1129000, `new pledge snapshots the funding rate ₹11,290 (${snap?.funding_paise})`);
    const sv = await sql1(`SELECT sv.id FROM scheme_version sv JOIN scheme s ON s.id=sv.scheme_id WHERE s.code='GL2070' AND sv.status='published' ORDER BY sv.version_no DESC LIMIT 1`);
    const pur = await sql1(`SELECT id FROM purity WHERE karat='22K' AND active`);
    const item = await sql1(`SELECT id FROM item WHERE active AND metal_id = 1 ORDER BY id LIMIT 1`);
    const save = await call(`/api/applications/${app.j.id}`, { schemeVersionId: sv.id, items: [{ itemId: item.id, qty: 1, grossMg: 10000, stoneMg: 0, purityId: pur.id }] }, own, "PATCH");
    const row = await sql1(`SELECT funding_paise, market_paise FROM appraisal_item WHERE application_id=$1`, [app.j.id]);
    ok(save.j?.ok && Number(row?.funding_paise) === 7280000 && Number(row?.market_paise) === 11320000, `saved appraisal row: funding ₹72,800 (lendable), market ₹1,13,200 kept for auction only (${save.j?.reason || "ok"})`);
    await call(`/api/applications/${app.j.id}/action`, { action: "cancel", reason: "walk", narration: "E34 walk fixture" }, own).catch(() => {});
  } else ok(false, `could not open a pledge for the wizard check: ${app.j?.reason}`);
} else ok(true, "no eligible customer for the wizard check — skipped");

// ═════ restore the gold pair ═════
const restore = await call("/api/rate", { marketRupees: Number(before.base_paise) / 100, fundingRupees: Number(before.funding_paise ?? before.base_paise) / 100, confirmed: true, metalId: 1 }, own);
const after = await sql1(`SELECT base_paise, funding_paise FROM rate_in_force(1, CURRENT_DATE)`);
ok(already(restore) && Number(after.funding_paise) === Number(before.funding_paise ?? before.base_paise), `gold pair restored to ${Number(after.base_paise) / 100} / ${Number(after.funding_paise) / 100} (${restore.status} ${restore.j?.reason || "ok"})`);

await pool.end();
console.log(failures ? `\n${failures} FAILED` : "\nE34 WALK PASS");
process.exit(failures ? 1 : 0);
