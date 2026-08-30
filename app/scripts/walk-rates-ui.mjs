/**
 * Walk: A1+A2 UI (owner GO, 30 Aug 2026). Playwright:
 *  · rate board: silver tab live; typing market auto-fills funding at −10%
 *    (floored to ₹100) until funding is hand-typed;
 *  · pledge wizard on the walk application: the silver row PRICES (no
 *    "no silver rate" chip) and shows the hand-computed market figure.
 * Run TWICE before packaging.
 */
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";
const APP = process.env.WALK_APP_ID || "76";
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`);
await page.fill("#u", "slunawat");
await page.fill("#p", "Testpass123456");
await page.click('button[type="submit"]');
await page.waitForURL(/home|branch/, { timeout: 20000 });
if (!page.url().includes("/home")) {   // branch chooser: pick B1
  await page.locator("button", { hasText: /B1|Bhagur/i }).first().click();
  await page.waitForURL("**/home", { timeout: 20000 });
}
ok(page.url().includes("/home"), "owner signed in at B1");

// —— rate board: silver tab + A1 auto-fill ——
await page.goto(`${BASE}/hq/rate?metal=2`, { waitUntil: "networkidle" });
const body = await page.innerText("body");
ok(/silver/i.test(body), "silver tab renders on the rate board");
const market = page.locator("input").first();
const funding = page.locator("input").nth(1);
await market.fill("");
await market.type("9050");
ok((await funding.inputValue()) === "8100",
  `funding auto-fills 9050 → ${await funding.inputValue()} (expect 8100 = −10% floored to ₹100)`);
await funding.fill("8000");
await market.fill("");
await market.type("9500");
ok((await funding.inputValue()) === "8000",
  "hand-typed funding survives further market typing");

// —— pledge wizard: silver row priced ——
await page.goto(`${BASE}/pledge/${APP}`, { waitUntil: "networkidle" });
const w = await page.innerText("body");
ok(/silver/i.test(w), "wizard shows the silver row");
ok(!/no silver rate/i.test(w), "the 'no silver rate' refusal is gone");
ok(/11,88,000/.test(w), "silver market value ₹11,88,000 appears (100g × ₹12,000 × 99%)");
ok(/1,13,200/.test(w), "gold market value ₹1,13,200 appears (10g × ₹12,300 × 92% rounded up)");

await browser.close();
console.log(failures === 0 ? "\nUI WALK PASS" : `\nUI WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
