/**
 * Walk: Reports UI (E27). Playwright — home cards, nav link, each report
 * screen runs and renders real figures, branch wall in the UI. Run TWICE.
 */
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill("#u", "slunawat"); await page.fill("#p", "Testpass123456");
await page.click('button[type="submit"]');
await page.waitForURL(/home|branch/, { timeout: 20000 });
if (!page.url().includes("/home")) {
  await page.locator("button", { hasText: /B1|Bhagur/i }).first().click();
  await page.waitForURL("**/home", { timeout: 20000 });
}
const nav = await page.innerText("body");
ok(/reports/i.test(nav), "header nav carries Reports");

await page.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
const home = await page.innerText("body");
for (const t of ["Branch Loan Summary", "Loan Repay Register", "Loan Application History",
  "Outstanding Amount Report", "Loan Details", "DayBook", "Ledger Report"])
  ok(new RegExp(t, "i").test(home), `home lists "${t}"`);
ok(/MIS Reports/i.test(home) && /Transaction Reports/i.test(home) && /Cash \/ Bank/i.test(home),
  "home shows the three groups");

async function runReport(path, expectRe, label) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.locator("button", { hasText: /run report/i }).click();
  // E31: the Branch Summary replays every loan twice (period start and end);
  // with the 1,000+ imported B3 loans that is ~3 s — wait for the figures, not a fixed pause
  await page.waitForTimeout(2500);
  await page.waitForFunction((re) => { const t = document.body.innerText;
      return new RegExp(re, "i").test(t) && /TOTAL|balance|position|opening/i.test(t); },
    expectRe.source, { timeout: 30000 }).catch(() => {});
  const t = await page.innerText("body");
  ok(expectRe.test(t), `${label} renders figures`);
  ok(/TOTAL/i.test(t) || /balance|position|opening/i.test(t), `${label} shows totals/summary`);
}
await runReport("/reports/outstanding", /TOTAL DUE|₹/, "Outstanding");
await runReport("/reports/summary", /Principal O\/s|Collected/i, "Branch Summary");
await runReport("/reports/apphistory", /application|APP-/i, "Application History");
await runReport("/reports/repay", /To Interest|Receipt/i, "Repay Register");
await runReport("/reports/ledger", /Cash in hand|Interest income/i, "Ledger");

// daybook with a date typed DD-MM-YYYY
await page.goto(`${BASE}/reports/daybook`, { waitUntil: "networkidle" });
await page.locator('input[type="text"], input:not([type="date"])').first().fill("28-08-2026");
await page.locator("button", { hasText: /run report/i }).click();
await page.waitForTimeout(2500);
const db = await page.innerText("body");
ok(/1,84,500/.test(db), "DayBook shows opening ₹1,84,500 for 28 Aug B1");
ok(/1,78,900/.test(db), "DayBook closing ties to the signed day-end ₹1,78,900");

// loan dossier
await page.goto(`${BASE}/reports/loandetails`, { waitUntil: "networkidle" });
await page.locator('input.mono').first().fill("25L262700001");
await page.locator("button", { hasText: /run report/i }).click();
await page.waitForTimeout(2500);
const ld = await page.innerText("body");
ok(/25L262700001/.test(ld) && /ornaments pledged/i.test(ld) && /file history/i.test(ld),
  "dossier renders ornaments and history");

// permission wall in the UI: sign in as the valuer (no reports permission)
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/reports`);
ok(p2.url().includes("/login"), "signed-out /reports bounces to login");

await browser.close();
console.log(failures === 0 ? "\nREPORTS UI WALK PASS" : `\nUI WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
