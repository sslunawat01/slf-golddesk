/**
 * Walk: create an employee through the REAL six-step wizard (owner report,
 * 14 Oct 2026 — "not able to select role while creating employee").
 *
 * Asserts at every step that the screen actually accepted the input, so a
 * pass can never be vacuous: the role pill must show ✓ after the click, the
 * Next button must enable, and the employee must exist in the DATABASE at
 * the end with exactly the role and branch picked.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-employee-create.mjs
 * Env: WALK_USER (default walkemp<time>) so reruns never collide.
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const suffix = String(Date.now()).slice(-6);
const USER = process.env.WALK_USER || `walkemp${suffix}`;
const MOBILE = "97" + suffix + "12";
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });

await page.goto(`${BASE}/login`);
await page.fill("#u", "slunawat"); await page.fill("#p", "Testpass123456");
await page.click('button[type="submit"]');
await page.waitForURL(/home|branch/, { timeout: 20000 });
if (!page.url().includes("/home")) {
  await page.locator("button", { hasText: /B1|Bhagur/i }).first().click();
  await page.waitForURL("**/home", { timeout: 20000 });
}
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.locator("button", { hasText: /^Employees$/ }).first().click();
await page.locator("button", { hasText: /New employee/i }).click();

const next = () => page.locator("button", { hasText: /^Next →$/ });
const field = (label) => page.locator("span", { hasText: label }).locator("xpath=following-sibling::*[1]");

// —— step 1 · identity ——
await field("Full name *").fill("Walk Test Employee");
await field("Mobile *").fill(MOBILE);
ok(await next().isEnabled(), "step 1: Next enables after name + mobile");
await next().click();

// —— step 2 · KYC ——
await field("PAN *¹").fill("WALKP" + suffix.slice(-4) + "Z");
ok(await next().isEnabled(), "step 2: Next enables after PAN");
await next().click();

// —— step 3 · employment — the reported bug lives here ——
await field("Designation *").fill("Counter Operator");
const rolePill = page.locator("button", { hasText: /^(✓ )?Counter Operator$/ });
await rolePill.click();
const pillText = (await rolePill.innerText()).trim();
ok(pillText.startsWith("✓"), `step 3: role pill shows ✓ after click (got "${pillText}")`);
await page.locator("button", { hasText: /Bhagur/ }).first().click();
ok(await next().isEnabled(), "step 3: Next enables once role + branch are picked");
await next().click();

// —— step 4 · access ——
await field("Username *").fill(USER);
await field("Password *").fill("Walkpass2026x");
await field("Type it again *").fill("Walkpass2026x");
ok(await next().isEnabled(), "step 4: Next enables after username + matching passwords");
await next().click();
await next().click();                       // step 5 has nothing to fill

// —— step 6 · review ——
const review = await page.innerText("body");
ok(/Roles\s+Counter Operator/i.test(review), "step 6: review lists the picked role");
await page.locator("button", { hasText: /Create employee/i }).click();
await page.waitForTimeout(800);
const confirmYes = page.locator("button", { hasText: /Yes — save/ });
if (await confirmYes.count()) { await confirmYes.click(); await page.waitForTimeout(800); }
await page.waitForSelector("text=shown once", { timeout: 10000 }).catch(() => {});
const done = await page.innerText("body");
ok(/Employee created/i.test(done) && done.includes(USER), "credentials card shows the new username");

// —— the database is the judge ——
const row = (await pool.query(
  `SELECT e.id, e.emp_code, e.full_name, e.status::text,
          array_agg(DISTINCT r.name) AS roles, array_agg(DISTINCT b.code) AS branches
     FROM employee e
     JOIN employee_role er ON er.employee_id = e.id JOIN role r ON r.id = er.role_id
     JOIN employee_branch eb ON eb.employee_id = e.id JOIN branch b ON b.id = eb.branch_id
    WHERE e.username = $1 GROUP BY e.id`, [USER])).rows[0];
ok(!!row, `employee ${USER} exists in the database`);
ok(row && row.roles.length === 1 && row.roles[0] === "Counter Operator",
  `exactly one role, Counter Operator (got ${row?.roles})`);
ok(row && row.branches.includes("01"), `posted to branch 01 (got ${row?.branches})`);
ok(row && row.status === "active", "status active");

// —— and the new person can actually sign in ——
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/login`);
await p2.fill("#u", USER); await p2.fill("#p", "Walkpass2026x");
await p2.click('button[type="submit"]');
await p2.waitForURL(/home|branch|setpw/, { timeout: 20000 }).catch(() => {});
ok(!p2.url().includes("/login"), `the new employee signs in (landed on ${p2.url().replace(BASE, "")})`);

await browser.close(); await pool.end();
console.log(failures === 0 ? `\nEMPLOYEE WALK PASS (${USER})` : `\nEMPLOYEE WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
