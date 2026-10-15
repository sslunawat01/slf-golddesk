/**
 * Walk: E28 browser layer — the screens whose code changed:
 *   · login with the branch PICKER (ticket path) — a multi-branch user
 *   · the header branch SWITCH (session path) — the owner
 *   · forgot-password shows the administrator message, never a code
 *   · collect: "Close loan" then typing a smaller amount sends closing:false
 * Run TWICE.  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-e28-ui.mjs
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
const browser = await chromium.launch();
const fresh = async () => { const p = await (await browser.newContext()).newPage();
  p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; }); return p; };

// —— 1 · login through the branch picker ——
const vij = (await pool.query(`SELECT id FROM employee WHERE username='vijay'`)).rows[0];
await pool.query(`DELETE FROM session WHERE employee_id=$1`, [vij.id]);     // local: force the picker
let p = await fresh();
await p.goto(`${BASE}/login`);
await p.fill("#u", "vijay"); await p.fill("#p", "Testpass123456");
await p.click('button[type="submit"]');
await p.waitForTimeout(1500);
const picker = await p.innerText("body");
ok(/branch/i.test(picker) && !p.url().includes("/home"), "multi-branch user sees the branch picker");
await p.locator("button[type=button]").filter({ hasText: /\w/ }).first().click();
await p.waitForURL("**/home", { timeout: 20000 }).catch(() => {});
ok(p.url().includes("/home"), `picking a branch signs in (landed on ${p.url().replace(BASE, "")})`);
await p.context().close();

// —— 2 · the owner switches branch from the header ——
p = await fresh();
await p.goto(`${BASE}/login`);
await p.fill("#u", "slunawat"); await p.fill("#p", "Testpass123456");
await p.click('button[type="submit"]');
await p.waitForURL(/home|branch/, { timeout: 20000 });
if (!p.url().includes("/home")) {
  await p.locator("button", { hasText: /B1|Bhagur/i }).first().click();
  await p.waitForURL("**/home", { timeout: 20000 });
}
const before = (await pool.query(`SELECT acting_branch_id FROM session WHERE employee_id=1 AND revoked_at IS NULL
                                   ORDER BY created_at DESC LIMIT 1`)).rows[0].acting_branch_id;
// switch to whichever of Pune (11) / B1 Bhagur (1) he is NOT at — never a no-op
const [goId, goRe] = Number(before) === 11 ? [1, /B1 Bhagur/] : [11, /Pune/];
await p.locator("button", { hasText: /▾/ }).first().click();
await p.locator("button", { hasText: goRe }).last().click();
await p.waitForTimeout(2500);
const after = (await pool.query(`SELECT acting_branch_id FROM session WHERE employee_id=1 AND revoked_at IS NULL
                                  ORDER BY created_at DESC LIMIT 1`)).rows[0].acting_branch_id;
const head = await p.innerText("body");
ok(Number(before) !== goId && Number(after) === goId && goRe.test(head),
  `header switch really moved the owner ${before} → ${after}`);
// leave him at Pune for the collect test below
if (goId !== 11) {
  await p.locator("button", { hasText: /▾/ }).first().click();
  await p.locator("button", { hasText: /Pune/ }).last().click();
  await p.waitForTimeout(2500);
}
const live = (await pool.query(`SELECT count(*)::int AS n FROM session WHERE employee_id=1 AND revoked_at IS NULL
                                  AND expires_at > now()`)).rows[0].n;
console.log(`INFO owner live sessions after switch: ${live}`);

// —— 3 · the collect screen: Close loan, then a smaller typed amount ——
const loan = (await pool.query(`SELECT id FROM loan WHERE status='active' AND branch_id=11 ORDER BY id LIMIT 1`)).rows[0];
await p.goto(`${BASE}/repay/${loan.id}`, { waitUntil: "networkidle" });
const receiveBtn = () => p.locator("button", { hasText: /^Receive / }).first();
await p.locator("button", { hasText: /^Close loan/ }).click();
const amtBox = p.locator('input[inputmode="numeric"]').first();
const closingAmt = await amtBox.inputValue();
const l1 = await receiveBtn().innerText();
ok(/close loan/i.test(l1), `after "Close loan" the button reads a closure ("${l1}")`);
await amtBox.fill(""); await amtBox.type("1000");
const l2 = await receiveBtn().innerText();
ok(/print receipt/i.test(l2) && !/close loan/i.test(l2),
  `typing ₹1000 switches it to a part payment ("${l2}") — the closing flag is OFF`);
await amtBox.fill(""); await amtBox.type(closingAmt);
const l3 = await receiveBtn().innerText();
ok(/close loan/i.test(l3), `retyping the exact settlement ₹${closingAmt} is a closure again ("${l3}")`);
await p.context().close();

// —— 4 · forgot-password page ——
p = await fresh();
await p.goto(`${BASE}/forgot`, { waitUntil: "networkidle" });
const who = p.locator("input").first();
await who.fill("slunawat");
await p.locator("button", { hasText: /send|otp|code|next/i }).first().click();
await p.waitForTimeout(1500);
const fp = await p.innerText("body");
ok(/administrator/i.test(fp), "forgot page tells the user to ask the administrator");
ok(!/\b\d{6}\b/.test(fp.replace(/\d{10}/g, "")), "no six-digit code anywhere on the page");
await p.context().close();

await browser.close(); await pool.end();
console.log(failures === 0 ? "\nE28 UI WALK PASS" : `\nE28 UI WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
