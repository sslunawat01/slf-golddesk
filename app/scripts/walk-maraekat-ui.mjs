/**
 * Walk: the Maraekat import in a real browser — a B3 Branch Manager finds an
 * imported customer by mobile, opens the customer, the running loan, the
 * collect screen, and the Loan Details dossier of a renewed loan. Read-only.
 * Run TWICE.  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-maraekat-ui.mjs
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");

const maker = await sql1(`SELECT id FROM employee WHERE emp_code='MRK-IMP-M'`);
const L = await sql1(`SELECT l.id, l.loan_no, l.principal_paise, c.id AS cid, c.cust_no, c.full_name, c.mobile
    FROM loan l JOIN customer c ON c.id=l.customer_id
   WHERE l.created_by=$1 AND l.status='active'
     AND NOT EXISTS (SELECT 1 FROM receipt r WHERE r.loan_id=l.id AND r.received_by<>$1)
   ORDER BY l.disbursed_at, l.id LIMIT 1`, [maker.id]);
const R = await sql1(`SELECT loan_no FROM loan l WHERE created_by=$1 AND status='closed_by_renewal'
                       AND EXISTS (SELECT 1 FROM renewal WHERE old_loan_id=l.id) ORDER BY id LIMIT 1`, [maker.id]);

const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
await p.goto(`${BASE}/login`);
await p.fill("#u", "nagin.kothari"); await p.fill("#p", "Testpass123456");
await p.click('button[type="submit"]');
await p.waitForURL(/home|branch|login/, { timeout: 20000 });
await p.waitForTimeout(1200);
if (!p.url().includes("/home")) {
  await p.locator("button", { hasText: /B3|Nashik/ }).first().click();
  await p.waitForURL("**/home", { timeout: 20000 });
}
const cur = await sql1(`SELECT acting_branch_id FROM session s JOIN employee e ON e.id=s.employee_id
  WHERE e.username='nagin.kothari' AND s.revoked_at IS NULL ORDER BY s.created_at DESC LIMIT 1`);
if (Number(cur.acting_branch_id) !== 3)
  await p.evaluate(async () => { await fetch("/api/auth/branch", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: 3 }) }); });

// —— 1 · search by the test mobile ——
await p.goto(`${BASE}/search`, { waitUntil: "networkidle" });
await p.locator("input.i").first().fill(L.mobile);
await p.waitForTimeout(1500);
const s1 = await p.innerText("body");
ok(s1.toLowerCase().includes(L.full_name.toLowerCase()) && s1.includes(L.cust_no),
  `search ${L.mobile} shows ${L.full_name} (${L.cust_no})`);
// …and by the Maraekat loan number
await p.locator("input.i").first().fill(L.loan_no);
await p.waitForTimeout(1500);
ok((await p.innerText("body")).includes(L.loan_no), `search ${L.loan_no} shows the running loan`);

// —— 2 · customer page ——
await p.goto(`${BASE}/customers/${L.cid}`, { waitUntil: "networkidle" });
const c = await p.innerText("body");
ok(c.includes(L.cust_no) && c.includes(L.loan_no), `customer page lists ${L.loan_no}`);
ok(/address not imported/i.test(c), "customer page shows the address placeholder plainly");

// —— 3 · loan page ——
await p.goto(`${BASE}/loans/${L.id}`, { waitUntil: "networkidle" });
const lp = await p.innerText("body");
ok(lp.includes(L.loan_no) && lp.includes(inr(L.principal_paise)), `loan page shows ${L.loan_no} · ${inr(L.principal_paise)}`);

// —— 4 · collect screen: the close figure is the engine's ——
const dues = await p.evaluate(async (id) => (await (await fetch(`/api/loans/${id}/dues`)).json()), L.id);
await p.goto(`${BASE}/repay/${L.id}`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
const rp = await p.innerText("body");
ok(rp.includes(`Close loan ₹${Math.round(dues.closing.settlement).toLocaleString("en-IN")}`),
  `collect screen offers "Close loan ₹${Math.round(dues.closing.settlement).toLocaleString("en-IN")}"`);

// —— 5 · Loan Details of a renewed loan ——
await p.goto(`${BASE}/reports/loandetails`, { waitUntil: "networkidle" });
await p.locator("input.mono").first().fill(R.loan_no);
await p.locator("button", { hasText: /run report/i }).first().click();
await p.waitForTimeout(2000);
const ld = await p.innerText("body");
ok(/closed_by_renewal/i.test(ld) && /closed by re-pledge/i.test(ld), `Loan Details ${R.loan_no}: closed by renewal, history says re-pledge`);
ok(/MRK · ReEntry adjustment/i.test(ld), "its closing receipt shows the ReEntry adjustment account");

// —— 6 · vault page ——
await p.goto(`${BASE}/vault`, { waitUntil: "networkidle" });
ok(!/application error/i.test(await p.innerText("body")), "vault page renders with 1,000+ imported packets");

await browser.close();
await pool.end();
console.log(failures === 0 ? "\nMARAEKAT UI WALK PASS" : `\nMARAEKAT UI WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
