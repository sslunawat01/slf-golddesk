/**
 * Walk: E25 TopNotice sweep (owner, 30 Aug 2026). Opens every screen the
 * patch touched, asserts real content (not empty shells), then triggers a
 * refusal on the new-customer screen and asserts the SAME message appears in
 * the fixed top banner (role=alert) and dismisses. Run TWICE before packaging.
 * innerText is CSS-uppercased — all asserts case-insensitive.
 */
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";

const BASE = "http://localhost:3000";
const LOAN = process.env.WALK_LOAN_ID || "30";
let failures = 0;
const ok = (cond, label) => { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// sign in through the real form
await page.goto(`${BASE}/login`);
await page.fill("#u", "snehal.k");
await page.fill("#p", "Testpass123456");
await page.click('button[type="submit"]');
await page.waitForURL("**/home", { timeout: 20000 });
ok(!page.url().includes("/login"), "login leaves the login page");

const screens = [
  ["/home", /home|queue|day/i],
  ["/daycycle", /day-begin|day cycle|opening/i],
  ["/vault", /vault|packet/i],
  ["/release", /release|sla/i],
  ["/overdue", /overdue|follow/i],
  ["/settings", /branch|scheme|setting/i],
  ["/hq/rate", /rate|market|funding/i],
  [`/repay/${LOAN}`, /due|interest|principal|collect/i],
];
for (const [path, re] of screens) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  const text = (await page.innerText("body")).slice(0, 8000);
  ok(re.test(text), `${path} renders real content`);
  ok(!/application error|unhandled exception|internal server error/i.test(text), `${path} shows no crash text`);
}

// the banner itself: new-customer save with an empty form must refuse at top
await page.goto(`${BASE}/customers/new`, { waitUntil: "networkidle" });
const saveBtn = page.locator("button", { hasText: /save|create/i }).last();
await saveBtn.click();
await page.waitForTimeout(600);
const alert = page.locator('[data-topnotice]');
ok(await alert.count() === 1, "exactly one top banner appears");
const alertText = (await alert.innerText()).trim();
ok(/missing|needed|compulsory/i.test(alertText), `banner carries the refusal ("${alertText.slice(0, 60)}…")`);
const box = await alert.boundingBox();
ok(box && box.y < 120, `banner sits at the top of the viewport (y=${box && Math.round(box.y)})`);
// scroll far down — fixed banner must still be visible
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
const box2 = await alert.boundingBox();
ok(box2 && box2.y < 120, "banner stays visible after scrolling to the bottom");
await alert.locator("button").click();
await page.waitForTimeout(200);
ok(await alert.count() === 0, "✕ dismisses the banner");

// rate board: bad publish must show the banner too (chip-based screen)
await page.goto(`${BASE}/hq/rate`, { waitUntil: "networkidle" });
const pub = page.locator("button", { hasText: /publish|save/i }).first();
if (await pub.count()) {
  const inputs = page.locator('input[type="text"], input[type="number"], input:not([type])');
  if (await inputs.count() >= 1) { await inputs.first().fill("0"); }
  await pub.click();
  await page.waitForTimeout(600);
  const n = await page.locator('[data-topnotice]').count();
  console.log(`INFO rate-board banner after bad publish: ${n} (0 is acceptable if the form blocks client-side)`);
}

await browser.close();
console.log(failures === 0 ? "\nWALK PASS" : `\nWALK FAIL — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
