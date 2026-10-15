/**
 * Walk: E35 browser layer. Run TWICE.
 *   · the initials badge opens the profile menu: name, username, Change my password, Sign out
 *   · Change my password → voluntary form → wrong current password refused on screen → correct one lands on /login?changed=1
 *   · the new password signs in; the forced form has no current-password field
 *   · Settings · Employees → Reset password dialog shows live rule chips
 *   · works at 1300 and 768 wide
 *  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-e35-ui.mjs
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const today = (await sql1(`SELECT CURRENT_DATE::text AS d`)).d;
const PW1 = "Walkpass2026x", PW2 = "Browserpw2026z";

// throwaway employee via the API (as the owner)
async function api(path, body, cookie) {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => null), setCookie: (r.headers.get("set-cookie") || "").split(";")[0] };
}
const a = await api("/api/auth/login", { username: "slunawat", password: "Testpass123456" });
let own = a.setCookie; if (a.j?.next === "branch") own = (await api("/api/auth/branch", { ticket: a.j.ticket, branchId: 3 })).setCookie;
const u = `walkui${String(Date.now()).slice(-5)}`;
const mk = await api("/api/settings/employees", { action: "create", fullName: "Walk Ui Password", mobile: "94" + String(Date.now()).slice(-8),
  panNo: "WALKU" + String(Date.now()).slice(-4) + "Q", designation: "Walk", doj: today, roleIds: [3], branchIds: [3], primaryBranchId: 3,
  username: u, password: PW1, confirm: PW1, dupAcknowledged: true }, own);
ok(mk.j?.ok === true, `created ${u}`);
const emp = await sql1(`SELECT id FROM employee WHERE username=$1`, [u]);

const browser = await chromium.launch();
async function signIn(p, user, pw) {
  await p.goto(`${BASE}/login`);
  await p.fill("#u", user); await p.fill("#p", pw);
  await p.click('button[type="submit"]');
  await p.waitForURL(/home|branch|login|setpw/, { timeout: 20000 }); await p.waitForTimeout(700);
  if (/branch/.test(p.url())) { await p.locator("button", { hasText: /B3|Nashik/ }).first().click(); await p.waitForURL(/home|setpw/, { timeout: 20000 }); }
}

for (const width of [1300, 768]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
  const W = `@${width}`;
  const pwNow = width === 1300 ? PW1 : PW2, pwNext = width === 1300 ? PW2 : PW1;
  await signIn(p, u, pwNow);
  ok(p.url().includes("/home"), `${W} signed in as ${u}`);

  // ── the profile menu ──
  await p.locator("[data-me-menu]").click();
  const panel = p.locator("[data-me-panel]");
  await panel.waitFor({ timeout: 5000 });
  const pt = await panel.textContent();
  ok(/Signed in as/.test(pt) && pt.includes("Walk Ui Password") && pt.includes(u) && /Change my password/.test(pt) && /Sign out/.test(pt), `${W} menu: name, username, Change my password, Sign out`);
  const box = await panel.boundingBox();
  ok(box.x >= 0 && box.x + box.width <= width + 1, `${W} menu stays inside the screen`);
  await panel.locator("[data-me-changepw]").click();
  await p.waitForURL("**/setpw", { timeout: 15000 });
  const form = p.locator('[data-setpw="voluntary"]');
  ok(await form.count() === 1 && await form.locator("[data-cur]").count() === 1, `${W} Change my password → voluntary form with Current password`);
  ok((await form.textContent()).includes(u), `${W} form names the signed-in user`);

  // ── wrong current password, refused on screen ──
  await form.locator("[data-cur]").fill("Wrongwrong1");
  await form.locator("[data-new]").fill(pwNext);
  await form.locator("[data-confirm]").fill(pwNext);
  ok(await form.locator(".chip.ok", { hasText: /passwords match/ }).count() === 1, `${W} live chips: passwords match`);
  await form.locator("[data-save]").click();
  await p.waitForSelector("text=/current password is not correct/i", { timeout: 10000 });
  ok(p.url().includes("/setpw"), `${W} wrong current password: refused, still on the form`);
  // the username rule is live on screen
  await form.locator("[data-new]").fill(u); await form.locator("[data-confirm]").fill(u);
  ok(await form.locator(".chip.mut", { hasText: /username/ }).count() === 1 && await form.locator("[data-save]").isDisabled(), `${W} password = username: rule chip off, button disabled`);
  await form.locator("[data-new]").fill(pwNext); await form.locator("[data-confirm]").fill(pwNext);

  // ── correct current password ──
  await form.locator("[data-cur]").fill(pwNow);
  await form.locator("[data-save]").click();
  await p.waitForURL(/login\?changed=1/, { timeout: 15000 });
  ok(/Password changed/.test(await p.locator("body").textContent()), `${W} lands on login with 'Password changed'`);
  await signIn(p, u, pwNext);
  ok(p.url().includes("/home"), `${W} the new password signs in`);
  const dbRow = await sql1(`SELECT count(*)::int n FROM session WHERE employee_id=$1 AND revoked_at IS NULL`, [emp.id]);
  ok(dbRow.n === 1, `${W} exactly one live session after the change (${dbRow.n})`);
  await ctx.close();
}

// ── forced form + admin reset dialog (1300) ──
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const p = await ctx.newPage();
p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
await pool.query(`UPDATE employee SET force_change = TRUE WHERE id=$1`, [emp.id]);
await signIn(p, u, PW1);
ok(p.url().includes("/setpw"), "temporary password → straight to /setpw");
const forced = p.locator('[data-setpw="forced"]');
ok(await forced.count() === 1 && await forced.locator("[data-cur]").count() === 0, "forced form: no Current password field");
await forced.locator("[data-new]").fill(PW2); await forced.locator("[data-confirm]").fill(PW2);
await forced.locator("[data-save]").click();
await p.waitForURL(/login\?changed=1/, { timeout: 15000 });
await signIn(p, u, PW2);
ok(p.url().includes("/home"), "forced change done; signs in normally");

// admin: Settings · Employees → Reset password dialog
await signIn(p, "slunawat", "Testpass123456");
await p.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await p.locator("button", { hasText: /^Employees$/ }).click();
await p.waitForSelector("text=Walk Ui Password", { timeout: 15000 });
await p.locator("tr", { hasText: "Walk Ui Password" }).first().click();      // expand the row
await p.locator("button", { hasText: /^Reset password$/ }).first().click();
await p.waitForSelector("[data-reset-pw]", { timeout: 10000 });
await p.locator("[data-reset-pw]").fill("abc");
const chips1 = await p.locator("[data-reset-pw]").locator("xpath=ancestor::div[contains(@class,'card')][1]").textContent();
ok(/• at least 10 characters/.test(chips1) && /• one number/.test(chips1), "reset dialog: rule chips show what is missing");
await p.locator("[data-reset-pw]").fill("Resetpass2026q"); await p.locator("[data-reset-confirm]").fill("Resetpass2026q");
const chips2 = await p.locator("[data-reset-pw]").locator("xpath=ancestor::div[contains(@class,'card')][1]").textContent();
ok(/✓ at least 10 characters/.test(chips2) && /✓ passwords match/.test(chips2), "reset dialog: all chips tick");
await p.locator("button", { hasText: /^Reset password$/ }).last().click();
await p.waitForSelector("text=/Password reset/", { timeout: 10000 });
ok(/profile menu/.test(await p.locator("body").textContent()), "the 'shown once' card points at the profile menu");
await ctx.close();

await api("/api/settings/employees", { action: "suspend", id: emp.id, dol: today, reason: "walk fixture done" }, own).catch(() => {});
await browser.close(); await pool.end();
console.log(failures ? `\nE35 UI WALK FAIL — ${failures}` : "\nE35 UI WALK PASS");
process.exit(failures ? 1 : 0);
