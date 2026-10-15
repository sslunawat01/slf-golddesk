/**
 * Walk: E34 browser layer. Run TWICE.
 *   · Settings · Metals: the reckoner multiplies the FUNDING rate (header says so; figures match)
 *   · HQ rate board: the per-purity reckoner quotes the lending (funding) rate only; history marks corrections
 *   · Loan Details report: a Funding ₹ column, no Market ₹
 *   · HQ approvals: no Market value
 *  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-e34-ui.mjs
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
pg.types.setTypeParser(1082, v => v);
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
const p = await ctx.newPage();
p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
await p.goto(`${BASE}/login`);
await p.fill("#u", "slunawat"); await p.fill("#p", "Testpass123456");
await p.click('button[type="submit"]');
await p.waitForURL(/home|branch|login/, { timeout: 20000 }); await p.waitForTimeout(800);
if (!p.url().includes("/home")) { await p.locator("button", { hasText: /B3|Nashik/ }).first().click(); await p.waitForURL("**/home", { timeout: 20000 }); }

// publish a visible haircut for the duration of the walk (a same-day correction — O-A closed)
const before = await sql1(`SELECT base_paise, funding_paise FROM daily_rate WHERE metal_id=1 AND rate_date < CURRENT_DATE ORDER BY rate_date DESC, published_at DESC LIMIT 1`);
const publish = (m, f) => p.evaluate(async ([m, f]) => {
  const r = await fetch("/api/rate", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ marketRupees: m, fundingRupees: f, confirmed: true, metalId: 1 }) });
  return { status: r.status, j: await r.json().catch(() => null) }; }, [m, f]);
const pub = await publish(12300, 11290);
ok(pub.j?.ok || /already/i.test(pub.j?.reason || ""), `gold 12,300 / 11,290 in force (${pub.status})`);

// ═════ Settings · Metals ═════
await p.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await p.locator("button", { hasText: /^Metals$/ }).click();
await p.waitForSelector("table", { timeout: 15000 }); await p.waitForTimeout(500);
const tbl = await p.locator("table").first().textContent();
ok(/Funding rate/i.test(tbl) && !/Base rate/i.test(tbl), "Metals reckoner header reads 'Funding rate ₹/g'");
const row22 = p.locator("tr", { hasText: /22K/ }).first();
const t22 = await row22.textContent();
ok(t22.includes("₹11,290") && t22.includes("₹10,386.8"), "22K row: funding ₹11,290 → rate at purity ₹10,386.80 (funding × 92%, exact)");
ok(!t22.includes("₹12,300") && !t22.includes("₹11,316"), "22K row carries no market figure (₹12,300 / ₹11,316)");
const hint = await p.locator("text=/funding rate ₹11,290 per g/").count();
ok(hint >= 1, "metal hint names the funding rate only");
ok(!/market ₹/i.test(await p.locator("body").textContent()), "no 'market ₹…' anywhere on the Metals tab");

// ═════ HQ rate board ═════
await p.goto(`${BASE}/hq/rate`, { waitUntil: "networkidle" });
const h2 = await p.locator("h2", { hasText: /Lending rate at each purity/ }).count();
ok(h2 === 1, "rate board: 'Lending rate at each purity' reckoner");
const reck = await p.locator("h2:has-text('Lending rate at each purity') + div").textContent();
ok(reck.includes(inr(Math.round(1129000 * 92 / 100))) && !/market/i.test(reck) && !reck.includes("₹11,316"), "reckoner quotes the funding figure per purity and no market figure");
ok(await p.locator("text=corrected later that day").count() >= 1, "history marks today's superseded publishes");
await p.evaluate(() => window.scrollTo(0, 0));

// ═════ Loan Details report ═════
const loan = await sql1(`SELECT l.loan_no FROM loan l WHERE l.branch_id=3 AND EXISTS (SELECT 1 FROM appraisal_item ai WHERE ai.application_id=l.application_id) ORDER BY l.id LIMIT 1`);
await p.goto(`${BASE}/reports/loandetails`, { waitUntil: "networkidle" });
await p.locator('input[placeholder="e.g. 01A6702302"]').fill(loan.loan_no);
await p.locator("button", { hasText: /Run report/ }).click();
await p.waitForSelector("text=/Funding ₹/", { timeout: 20000 });
const body = await p.locator("body").textContent();
ok(/Funding ₹/.test(body) && !/Market ₹/.test(body) && !/Lendable ₹/.test(body), "Loan Details: one 'Funding ₹' column, no 'Market ₹'");

// ═════ HQ approvals ═════
await p.goto(`${BASE}/hq/approvals`, { waitUntil: "networkidle" });
const ab = await p.locator("body").textContent();
ok(!/Market value/i.test(ab), "HQ approvals: no 'Market value' cell");

// restore
const rs = await publish(Number(before.base_paise) / 100, Number(before.funding_paise ?? before.base_paise) / 100);
const after = await sql1(`SELECT funding_paise FROM rate_in_force(1, CURRENT_DATE)`);
ok((rs.j?.ok || /already/i.test(rs.j?.reason || "")) && Number(after.funding_paise) === Number(before.funding_paise ?? before.base_paise), `gold pair restored (${rs.status})`);

await browser.close(); await pool.end();
console.log(failures ? `\nE34 UI WALK FAIL — ${failures}` : "\nE34 UI WALK PASS");
process.exit(failures ? 1 : 0);
