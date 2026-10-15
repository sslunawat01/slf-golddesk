/**
 * Walk: E32 browser layer. Run TWICE.
 *   №1 the camera dialog's Take-photo button is on screen on a phone held upright
 *   №2 scheme first, no market value in the wizard
 *   №3 gross / stone / net follow whichever was typed last
 *   №5 the warning pop-up greets the operator on the customer page, and "Noted" dismisses it
 *   №6 Settings · Limits tab shows the legal figures
 *   №10 age appears beside the date of birth on the new-customer form
 *  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-e32-ui.mjs
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
const RUN = String(Date.now()).slice(-6);
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");

// a fresh draft application at B3 for an imported customer with a warning remark
const cust = await sql1(`SELECT c.id, c.full_name FROM customer c WHERE c.cust_no LIKE 'IND%' AND c.blacklist_remark IS NULL ORDER BY c.id LIMIT 1`);
await pool.query(`UPDATE customer SET warning_remark=$2, warning_set_by=1, warning_set_at=now() WHERE id=$1`, [cust.id, `UI walk warning ${RUN}`]);
const nagin = await sql1(`SELECT id FROM employee WHERE username='nagin.kothari'`);
const rate = await sql1(`SELECT base_paise, funding_paise FROM daily_rate WHERE metal_id=1 ORDER BY rate_date DESC, published_at DESC LIMIT 1`);
const app = await sql1(`INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status, rate_date,
    base_paise_snapshot, funding_paise_snapshot, purpose, created_by)
  VALUES ('APP-E32UI-' || $3, 1, 3, $1, 'draft', CURRENT_DATE, $4, $5, 'personal', $2) RETURNING id`,
  [cust.id, nagin.id, RUN, rate.base_paise, rate.funding_paise]);
await pool.query(`INSERT INTO application_rate (application_id, metal_id, base_paise, funding_paise) VALUES ($1, 1, $2, $3)`,
  [app.id, rate.base_paise, rate.funding_paise]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
const p = await ctx.newPage();
p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
await p.goto(`${BASE}/login`);
await p.fill("#u", "nagin.kothari"); await p.fill("#p", "Testpass123456");
await p.click('button[type="submit"]');
await p.waitForURL(/home|branch|login/, { timeout: 20000 });
await p.waitForTimeout(1000);
if (!p.url().includes("/home")) { await p.locator("button", { hasText: /B3|Nashik/ }).first().click(); await p.waitForURL("**/home", { timeout: 20000 }); }
const cur = await sql1(`SELECT acting_branch_id FROM session s JOIN employee e ON e.id=s.employee_id
  WHERE e.username='nagin.kothari' AND s.revoked_at IS NULL ORDER BY s.created_at DESC LIMIT 1`);
if (Number(cur.acting_branch_id) !== 3)
  await p.evaluate(async () => { await fetch("/api/auth/branch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: 3 }) }); });

// ═════ №5 · pop-up on the customer page ═════
await p.goto(`${BASE}/customers/${cust.id}`, { waitUntil: "networkidle" });
await p.waitForTimeout(600);
const pop = p.locator("[data-remark-popup]");
ok(await pop.count() === 1 && (await pop.innerText()).includes(`UI walk warning ${RUN}`), "warning pop-up greets the operator on the customer page");
await pop.locator("button", { hasText: /noted/i }).click();
await p.waitForTimeout(300);
ok(await pop.count() === 0, "Noted dismisses it");
ok(/remarks/i.test(await p.innerText("body")), "the Remarks card is on the page");

// ═════ №2/№3 · wizard ═════
await p.goto(`${BASE}/pledge/${app.id}`, { waitUntil: "networkidle" });
await p.waitForTimeout(800);
await p.locator("[data-remark-popup] button", { hasText: /noted/i }).click().catch(() => {});
const body1 = await p.innerText("body");
ok(/choose before weighing/i.test(body1), "scheme chooser sits at the top of step 1");
ok(!/MARKET VALUE/.test(body1) && /FUNDING VALUE/.test(body1), "grid shows FUNDING VALUE and no MARKET VALUE column");
const schemeSel = p.locator("select[data-scheme-first]");
const optVal = await schemeSel.locator("option").nth(1).getAttribute("value");
await schemeSel.selectOption(optVal);
// weights: gross 10, stone 1 → net 9; then net 8 → stone 2; then gross 20 → net 18
const gross = p.locator('input[aria-label="gross g"]').first();
const stone = p.locator('input[aria-label="stone g"]').first();
const net = p.locator('input[aria-label="net g"]').first();
await gross.fill("10"); await stone.fill("1");
ok(await net.inputValue() === "9.000", `gross 10, stone 1 → net ${await net.inputValue()}`);
await net.fill("8");
ok(await stone.inputValue() === "2.000", `net typed 8 → stone ${await stone.inputValue()}`);
await gross.fill("20");
ok(await net.inputValue() === "18.000" && await stone.inputValue() === "2.000", `gross 20 → net ${await net.inputValue()}, stone kept ${await stone.inputValue()}`);
await stone.fill("25");
ok(await net.inputValue() === "0.000", "stone above gross → net floors at 0.000");
await stone.fill("2");
// pick item + purity → funding value appears, no market figure anywhere in the grid
await p.locator("tbody select").first().selectOption({ index: 1 });
const purity = p.locator("tbody select").nth(2);
await purity.selectOption({ index: 1 });
await p.waitForTimeout(300);
const body2 = await p.innerText("body");
ok(/₹[\d,]+/.test(body2) && !/Valuation/.test(body2), "a funding value is priced; no 'Valuation' figure in the wizard");

// ═════ №1 · camera dialog on a phone held upright ═════
const phone = await browser.newContext({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true,
  permissions: ["camera"] });
// a fake camera stream so getUserMedia succeeds headlessly: a tall 9:16 canvas
const m = await phone.newPage();
await m.addInitScript(() => {
  const canvas = document.createElement("canvas"); canvas.width = 720; canvas.height = 1280;
  const cx = canvas.getContext("2d"); cx.fillStyle = "#334"; cx.fillRect(0, 0, 720, 1280);
  setInterval(() => { cx.fillStyle = "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0"); cx.fillRect(10, 10, 100, 100); }, 100);
  navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(10);
});
await m.goto(`${BASE}/login`);
await m.fill("#u", "nagin.kothari"); await m.fill("#p", "Testpass123456");
await m.click('button[type="submit"]');
await m.waitForURL(/home|branch|login/, { timeout: 20000 }); await m.waitForTimeout(800);
if (!m.url().includes("/home")) { await m.locator("button", { hasText: /B3|Nashik/ }).first().click(); await m.waitForURL("**/home", { timeout: 20000 }); }
await m.goto(`${BASE}/customers/new`, { waitUntil: "networkidle" });
await m.locator("button", { hasText: /take photo/i }).first().click();
await m.waitForTimeout(1200);
const take = m.locator("button", { hasText: /📸 Take photo/ }).last();
const box = await take.boundingBox();
ok(box && box.y + box.height <= 740 && box.y >= 0, `phone upright: the Take-photo button is on screen (y=${box ? Math.round(box.y) : "none"} of 740)`);
await take.click();
await m.waitForTimeout(800);
ok((await m.innerText("body")).includes("Use photo"), "the snap lands in the crop/rotate editor");
await m.locator("button", { hasText: /cancel/i }).last().click();

// ═════ №10 · age beside date of birth ═════
await m.locator("input").filter({ hasText: "" }).first();
const dob = m.locator("input[placeholder*='DD'], input[placeholder*='dd']").first();
if (await dob.count()) { await dob.fill("05-05-2012"); await dob.press("Tab"); await m.waitForTimeout(300);
  const t = await m.innerText("body");
  ok(/age 14/i.test(t) && /under 18/i.test(t), "DOB 05-05-2012 shows 'age 14' and the under-18 refusal");
} else ok(false, "date-of-birth input not found");

// ═════ №6 · Settings · Limits ═════
const o = await ctx.newPage();
await o.goto(`${BASE}/login`); await o.fill("#u", "slunawat"); await o.fill("#p", "Testpass123456"); await o.click('button[type="submit"]');
await o.waitForURL(/home|branch|login/, { timeout: 20000 }); await o.waitForTimeout(800);
if (!o.url().includes("/home")) { await o.locator("button", { hasText: /B3|Nashik|Head|Bhagur/ }).first().click(); await o.waitForURL("**/home", { timeout: 20000 }); }
await o.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await o.locator("button", { hasText: /^Limits$/ }).click();
await o.waitForTimeout(800);
const lt = await o.innerText("body");
ok(/20,000/.test(lt) && /2,00,000/.test(lt) && /269SS/.test(lt), "Limits tab shows both figures with the law beside each");

// tidy
await pool.query(`UPDATE customer SET warning_remark=NULL, warning_set_by=NULL, warning_set_at=NULL WHERE id=$1`, [cust.id]);
await browser.close(); await pool.end();
console.log(failures === 0 ? "\nE32 UI WALK PASS" : `\nE32 UI WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
