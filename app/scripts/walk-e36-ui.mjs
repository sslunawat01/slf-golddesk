/**
 * Walk: E36 browser layer, at 1300 and 768. Run TWICE (fresh never-paid B3 loan each run).
 *   · collect screen: the clock strip; the working row's days; typing a PART amount shows
 *     "pays N days … still due M days" live; the Interest-only button shows "paid in full";
 *     the receipt view and print block carry "paid up to"; the loan page's clock follows
 *  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-e36-ui.mjs
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
const dmy = (iso) => String(iso).split("-").reverse().join("-");
const today = (await sql1(`SELECT CURRENT_DATE::text AS d`)).d;

const browser = await chromium.launch();
for (const width of [1300, 768]) {
  const W = `@${width}`;
  const L = await sql1(`SELECT l.id, l.loan_no, l.disbursed_at::text AS disbursed_at FROM loan l
    WHERE l.status='active' AND l.branch_id=3 AND l.principal_paise >= 2000000 AND l.disbursed_at <= CURRENT_DATE - 40
      AND NOT EXISTS (SELECT 1 FROM receipt r WHERE r.loan_id=l.id)
      AND NOT EXISTS (SELECT 1 FROM loan_charge c WHERE c.loan_id=l.id AND c.removed_at IS NULL) ORDER BY l.id LIMIT 1`);
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
  await p.goto(`${BASE}/login`); await p.fill("#u", "nagin.kothari"); await p.fill("#p", "Testpass123456");
  await p.click('button[type="submit"]'); await p.waitForURL(/home|branch/, { timeout: 20000 }); await p.waitForTimeout(600);
  if (!p.url().includes("/home")) { await p.locator("button", { hasText: /B3|Nashik/ }).first().click(); await p.waitForURL("**/home", { timeout: 20000 }); }
  await p.evaluate(async () => { await fetch("/api/auth/branch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: 3 }) }); });

  // ── collect screen, nothing paid ──
  await p.goto(`${BASE}/repay/${L.id}`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-interest-clock]", { timeout: 20000 });
  const d = await p.evaluate(async (id) => (await fetch(`/api/loans/${id}/dues`)).json(), L.id);
  const cov = d.coverage, run = d.running;
  const clock = await p.locator("[data-interest-clock]").textContent();
  ok(/No interest paid yet/.test(clock) && clock.includes(`Due for ${cov.dueDays} days`) && clock.includes(dmy(cov.dueFrom)), `${W} clock strip: no interest paid, due for ${cov.dueDays} days from ${dmy(cov.dueFrom)}`);
  ok(await p.locator("[data-work-days]").count() === 0, `${W} working row has no paid/due line while nothing is paid`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${W} no horizontal scroll`);

  // ── type a part amount ──
  const halfInt = Math.max(100, Math.floor(run.interest.due / 2 / 10) * 10);
  const part = Math.round(run.charges.due + run.penal.due + halfInt);
  const amtBox = p.locator("input[inputmode=numeric]").first();
  await amtBox.fill(String(part)); await p.waitForTimeout(200);
  const pay = await p.locator("[data-pay-days]").textContent();
  const toInt = halfInt, expectDays = Math.min(cov.dueDays - 1, Math.floor(toInt * 100 / cov.perDayPaise));
  ok(pay.includes(`₹${toInt.toLocaleString("en-IN")} pays ${expectDays} days`) && pay.includes(dmy(cov.dueFrom)) && pay.includes(`Still due: ${cov.dueDays - expectDays} days`), `${W} live preview: ₹${toInt} pays ${expectDays} days, ${cov.dueDays - expectDays} still due`);
  const chip = await p.locator(".chip.warn", { hasText: /part interest/ }).textContent();
  ok(chip.includes(`pays ${expectDays} days`) && chip.includes(`${cov.dueDays - expectDays} days still due`), `${W} chip repeats the days`);
  // less than a day
  await amtBox.fill(String(Math.round(run.charges.due + run.penal.due + 100))); await p.waitForTimeout(150);
  const tiny = await p.locator("[data-pay-days]").textContent();
  ok(cov.perDayPaise > 10000 ? /less than one day/.test(tiny) : /pays \d+ day/.test(tiny), `${W} ₹100 to interest: "${tiny.slice(0, 60)}…"`);
  // interest only → paid in full
  await p.locator("button", { hasText: /^(Interest only|Charges \+ interest)/ }).click(); await p.waitForTimeout(200);
  const full = await p.locator("[data-pay-days]").textContent();
  ok(/Interest paid in full/.test(full) && full.includes(`all ${cov.dueDays} days`) && full.includes(`paid up to ${dmy(today)}`), `${W} Interest-only: "paid in full for all ${cov.dueDays} days, paid up to today"`);
  ok(await p.locator(".chip.ok", { hasText: /clears all interest/ }).count() === 1, `${W} chip: clears all interest`);

  // ── take the PART payment for real (cash) ──
  await amtBox.fill(String(part));
  await p.selectOption("select", "cash"); await p.waitForTimeout(200);
  await p.locator("button", { hasText: /^Receive/ }).click();
  await p.waitForSelector("text=/Receipt /", { timeout: 20000 });
  const done = await p.locator("body").textContent();
  const after = (await p.evaluate(async (id) => (await fetch(`/api/loans/${id}/dues`)).json(), L.id)).coverage;
  ok(done.includes(`Interest paid up to ${dmy(after.paidUpTo)} (${after.paidDaysTotal} days)`) && done.includes(`Due for ${after.dueDays} days`), `${W} receipt view: paid up to ${dmy(after.paidUpTo)}, due for ${after.dueDays} days`);
  const print = await p.locator("#slf-receipt").textContent();
  ok(print.includes(`Interest paid up to: ${dmy(after.paidUpTo)} (${after.paidDaysTotal} days)`) && print.includes(`Interest still due: ${after.dueDays} days from ${dmy(after.dueFrom)}`), `${W} printed receipt carries both lines`);

  // ── loan page after the part payment ──
  await p.goto(`${BASE}/loans/${L.id}`, { waitUntil: "networkidle" });
  const lc = await p.locator("[data-interest-clock]").textContent();
  ok(lc.includes(`Interest paid up to ${dmy(after.paidUpTo)} (${after.paidDaysTotal} days)`) && lc.includes(`Due for ${after.dueDays} days — ${dmy(after.dueFrom)} to ${dmy(today)}`), `${W} loan page clock: paid up to ${dmy(after.paidUpTo)}, due ${after.dueDays} days`);
  // ── collect screen now shows the split in the working row ──
  await p.goto(`${BASE}/repay/${L.id}`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-work-days]", { timeout: 20000 });
  const wd = await p.locator("[data-work-days]").textContent();
  ok(wd.includes(`${after.paidDays} days already paid`) && wd.includes(`${after.dueDays} days due`), `${W} working row: ${after.paidDays} already paid · ${after.dueDays} due`);
  await ctx.close();
}
await browser.close(); await pool.end();
console.log(failures ? `\nE36 UI WALK FAIL — ${failures}` : "\nE36 UI WALK PASS");
process.exit(failures ? 1 : 0);
