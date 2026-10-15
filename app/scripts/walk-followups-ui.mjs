/**
 * Walk: E33 browser layer, at DESKTOP 1300, TABLET-landscape 1024 and TABLET-portrait 768. Run TWICE.
 *   · the tab opens on today for the acting branch; Missed / Today groups; presets; custom range; centre select
 *   · History panel (side panel on desktop, full screen on tablet); Log panel; Save & next walks the list
 *   · the nav badge and the Home card agree with the database
 *   · the loan page's Follow-ups section: banner, log in place, timeline refresh
 *   · the Follow-up Register: run, KPI tiles, tabs
 *   · no horizontal page scroll at any width; no page errors
 *  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-followups-ui.mjs
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
pg.types.setTypeParser(1082, v => v);
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql = async (t, p) => (await pool.query(t, p)).rows;
const sql1 = async (t, p) => (await sql(t, p))[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };
const RUN = String(Date.now()).slice(-6);
await pool.query("SELECT set_config('app.entity_ids','ALL',false)");
const today = (await sql1(`SELECT CURRENT_DATE::text AS d`)).d;
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => iso.split("-").reverse().join("-");
// append-only table: neutralise due items left by earlier walk runs so the bands hold only this run's fixtures
await pool.query(`INSERT INTO collection_call (loan_id, method, outcome, note, by_employee, fu_type, channel)
  SELECT x.loan_id, 'call', 'other', 'walk cleanup', 1, 'other', 'call'
    FROM (SELECT DISTINCT ON (cc.loan_id) cc.loan_id, cc.next_follow_up, cc.note FROM collection_call cc JOIN loan l ON l.id = cc.loan_id
           WHERE l.branch_id = 3 ORDER BY cc.loan_id, cc.at DESC, cc.id DESC) x
   WHERE x.next_follow_up IS NOT NULL AND (x.note LIKE 'Walk %' OR x.note LIKE 'UI walk %')`);
const NAG = (await sql1(`SELECT id FROM employee WHERE username='nagin.kothari'`)).id;
const noScroll = async (p, label) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no horizontal page scroll`);

async function fixtures() {
  // three running B3 loans nobody has followed up: U1 due today (for Nagin), U2 missed (yesterday), U3 due in 2 days
  const [U1, U2, U3] = await sql(`SELECT l.id, l.loan_no, c.full_name AS customer FROM loan l JOIN customer c ON c.id=l.customer_id
    WHERE l.status='active' AND l.branch_id=3 AND NOT EXISTS (SELECT 1 FROM collection_call cc WHERE cc.loan_id=l.id) ORDER BY l.id LIMIT 3`);
  const ins = (loanId, next, daysAgo, assigned) => pool.query(`INSERT INTO collection_call (loan_id, method, outcome, next_follow_up, note, by_employee, at, fu_type, channel, next_type, assigned_to)
    VALUES ($1,'call','no_answer',$2,$3,$4, now() - ($5 || ' days')::interval,'interest','call','interest',$6)`, [loanId, next, `UI walk ${RUN}`, NAG, String(daysAgo), assigned]);
  await ins(U1.id, today, 2, NAG);
  await ins(U2.id, addDays(today, -1), 4, null);
  await ins(U3.id, addDays(today, 2), 1, NAG);
  return { U1, U2, U3 };
}
async function login(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
  await p.goto(`${BASE}/login`);
  await p.fill("#u", "nagin.kothari"); await p.fill("#p", "Testpass123456");
  await p.click('button[type="submit"]');
  await p.waitForURL(/home|branch|login/, { timeout: 20000 });
  await p.waitForTimeout(800);
  if (!p.url().includes("/home")) { await p.locator("button", { hasText: /B3|Nashik/ }).first().click(); await p.waitForURL("**/home", { timeout: 20000 }); }
  await p.evaluate(async () => { await fetch("/api/auth/branch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: 3 }) }); });
  return p;
}
const openDue = async () => (await sql1(`SELECT count(*)::int n FROM (SELECT DISTINCT ON (cc.loan_id) cc.next_follow_up nf FROM collection_call cc JOIN loan l ON l.id=cc.loan_id
  WHERE l.branch_id=3 AND l.status='active' ORDER BY cc.loan_id, cc.at DESC, cc.id DESC) x WHERE nf IS NOT NULL AND nf <= CURRENT_DATE`)).n;

const browser = await chromium.launch();
for (const width of [1300, 1024, 768]) {
  console.log(`\n═════ width ${width} ═════`);
  const { U1, U2, U3 } = await fixtures();
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const p = await login(ctx);
  const W = `@${width}`;

  // ── Home card + badge (before anything is logged) ──
  await p.goto(`${BASE}/home`, { waitUntil: "networkidle" });
  const expected = await openDue();
  const badge = await p.locator("[data-fu-badge]").first().textContent().catch(() => null);
  ok(Number(badge) === expected, `${W} nav badge ${badge} = DB open-due ${expected}`);
  const card = p.locator("[data-fu-home]");
  ok(await card.count() === 1 && (await card.textContent()).includes(U2.loan_no) && /missed/i.test(await card.textContent()), `${W} Home card shows the missed loan`);
  await noScroll(p, `${W} home`);

  // ── the tab opens on today ──
  await p.goto(`${BASE}/followups`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-fu-list]", { timeout: 20000 });
  const rowU1 = p.locator(`[data-fu-row="${U1.loan_no}"]`), rowU2 = p.locator(`[data-fu-row="${U2.loan_no}"]`), rowU3 = p.locator(`[data-fu-row="${U3.loan_no}"]`);
  ok(await rowU1.count() === 1 && await rowU2.count() === 1 && await rowU3.count() === 0, `${W} today: U1 (today) and U2 (missed) listed, U3 (in 2 days) not`);
  ok(/today/i.test(await rowU1.textContent()) && /1 day late/i.test(await rowU2.textContent()), `${W} chips: 'today' on U1, '1 day late' on U2`);
  ok(/Me/.test(await rowU1.locator(".fu-cell-assigned").textContent()) && /anyone/i.test(await rowU2.locator(".fu-cell-assigned").textContent()), `${W} assigned: U1 'Me', U2 'anyone'`);
  const groups = await p.locator(".fu-group").allTextContents();
  ok(groups.some(g => /missed/i.test(g)) && groups.some(g => /today/i.test(g)), `${W} groups: Missed and Today headers present`);
  ok(/Nagin|B3|Bhagur/i.test(await p.locator("h1 + div").first().textContent()), `${W} header names the scope`);
  await noScroll(p, `${W} tab`);
  const headVisible = await p.locator(".fu-head").isVisible();
  ok(width >= 1024 ? headVisible : !headVisible, `${W} column header ${headVisible ? "shown" : "hidden"} (${width >= 1024 ? "desktop grid" : "card layout"})`);
  if (width < 1024) {
    const cols = await rowU1.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    ok(cols === 2, `${W} row collapses to a 2-column card (${cols} cols)`);
  }

  // ── presets ──
  await p.locator(".fu-pill", { hasText: /^This week/ }).click();
  await p.waitForSelector(`[data-fu-row="${U3.loan_no}"]`, { timeout: 15000 });
  ok(await rowU3.count() === 1 && /in 2 days/i.test(await rowU3.textContent()), `${W} This week: U3 appears 'in 2 days'`);
  await p.locator(".fu-pill", { hasText: /^Missed/ }).click();
  await p.waitForTimeout(1200);
  ok(await rowU2.count() === 1 && await rowU1.count() === 0, `${W} Missed: only U2`);

  // ── custom range on U3's day ──
  await p.locator(".fu-pill", { hasText: /^Custom range/ }).click();
  const dates = p.locator('input[placeholder="DD-MM-YYYY"]');
  await dates.nth(0).fill(dmy(addDays(today, 2))); await dates.nth(1).fill(dmy(addDays(today, 2)));
  await p.locator("button", { hasText: /^Show$/ }).click();
  await p.waitForSelector(`[data-fu-row="${U3.loan_no}"]`, { timeout: 15000 });
  ok(await rowU3.count() === 1 && await rowU1.count() === 0 && await rowU2.count() === 0, `${W} custom range: only U3`);
  await p.locator(".fu-pill", { hasText: /^Today/ }).click();
  await p.waitForSelector(`[data-fu-row="${U1.loan_no}"]`, { timeout: 15000 });

  // ── centre select ──
  await p.selectOption("[data-fu-branch]", "2");
  await p.waitForTimeout(1500);
  ok(await rowU1.count() === 0 && /B2|Nasikroad/i.test(await p.locator("h1 + div").first().textContent()), `${W} centre B2: U1 gone, header says B2`);
  await p.selectOption("[data-fu-branch]", "3");
  await p.waitForSelector(`[data-fu-row="${U1.loan_no}"]`, { timeout: 15000 });

  // ── History panel ──
  await rowU1.locator("[data-fu-history]").click();
  const panel = p.locator("[data-fu-panel]");
  await p.waitForSelector("[data-fu-timeline]", { timeout: 15000 });
  ok(await panel.getAttribute("data-fu-panel") === "history" && (await panel.textContent()).includes(U1.customer), `${W} History panel opens for ${U1.customer}`);
  ok(/due TODAY/i.test(await panel.textContent()) && (await panel.locator("[data-fu-item]").count()) === 1, `${W} panel: next-due banner + 1 timeline item`);
  const box = await panel.boundingBox();
  if (width > 1180) {
    ok(box.width >= 500 && box.width < width - 300, `${W} panel sits beside the list (${Math.round(box.width)}px wide)`);
    const cols = await rowU1.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    const clipped = await rowU1.locator(".fu-actions").evaluate(el => { const r = el.getBoundingClientRect(), c = el.closest("[data-fu-list]").getBoundingClientRect(); return r.right > c.right + 1; });
    ok(cols === 2 && !clipped && !(await p.locator(".fu-head").isVisible()), `${W} list beside the panel collapses to cards (${cols} cols), actions not clipped`);
  }
  else ok(Math.abs(box.width - width) <= 2 && box.x <= 1, `${W} panel takes the full screen (${Math.round(box.width)}px)`);
  await noScroll(p, `${W} with panel`);
  await panel.locator("[data-fu-close]").click();
  ok(await panel.count() === 0, `${W} ✕ closes the panel`);

  // ── a suggested row's Log form starts on the suggested type ──
  const sug = p.locator('[data-fu-row]').filter({ hasText: /suggested/ }).first();
  if (await sug.count()) {
    const sugType = (await sug.locator(".fu-cell-type").textContent()).split("\n")[0].trim().split(" · ")[0];
    await sug.locator("[data-fu-log]").click();
    await p.waitForSelector("[data-fu-form]", { timeout: 15000 });
    const onPill = await p.locator('[data-fu-form] .fu-pill[data-pill="on"]').first().textContent();
    ok(sugType.startsWith(onPill.trim()), `${W} suggested row '${sugType}' → form starts on '${onPill.trim()}'`);
    await p.locator("[data-fu-close]").click();
  }

  // ── Log on U2 (missed, first in the list): promise → Save & next → U1 ──
  await rowU2.locator("[data-fu-log]").click();
  await p.waitForSelector("[data-fu-form]", { timeout: 15000 });
  ok(await panel.getAttribute("data-fu-panel") === "log" && /\d+ of \d+/.test(await panel.textContent()) && /Clears the due item/.test(await panel.textContent()), `${W} Log panel on U2: 'n of N', clears the due item`);
  await panel.locator(".fu-pill", { hasText: /^Promised to pay/ }).click();
  await panel.locator("[data-ptp-amount]").fill("1500");
  await panel.locator('input[placeholder="DD-MM-YYYY"]').first().fill(dmy(addDays(today, 2)));
  await panel.locator("[data-fu-remark]").fill(`UI walk ${RUN} promise`);
  await panel.locator(".fu-pill.small", { hasText: /Spoke to borrower/ }).click();
  ok((await panel.locator("[data-fu-remark]").inputValue()).endsWith("Spoke to borrower"), `${W} quick phrase appends to the remark`);
  ok(await panel.locator(".fu-pill", { hasText: /On PTP day/ }).getAttribute("data-pill") === "on", `${W} next follow-up pre-set to the PTP day`);
  await panel.locator("[data-fu-save-next]").click();
  await p.waitForFunction((no) => document.querySelector("[data-fu-panel]")?.textContent.includes(no), U1.loan_no, { timeout: 15000 });
  await p.waitForTimeout(800);
  ok(/\d+ of \d+/.test(await panel.textContent()) && (await panel.textContent()).includes(U1.customer) && await panel.getAttribute("data-fu-panel") === "log", `${W} Save & next moved the panel to U1 (still in log mode)`);
  ok(/logged/i.test(await rowU2.textContent()), `${W} U2's row now says ✓ logged`);
  const saved = await sql1(`SELECT outcome::text o, ptp_amount_paise::int amt, ptp_date, next_follow_up nf, next_type::text nt, note FROM collection_call WHERE loan_id=$1 ORDER BY id DESC LIMIT 1`, [U2.id]);
  ok(saved.o === "promised" && saved.amt === 150000 && saved.ptp_date === addDays(today, 2) && saved.nf === addDays(today, 2) && saved.nt === "ptp" && saved.note.includes(`UI walk ${RUN} promise`), `${W} DB: promise ₹1,500 by ${dmy(saved.ptp_date)}, next ${saved.nf} as PTP check`);
  // U1: no answer, tomorrow, plain save
  await p.waitForSelector("[data-fu-form]", { timeout: 15000 });
  await panel.locator(".fu-pill", { hasText: /^No answer/ }).click();
  await panel.locator(".fu-pill", { hasText: /^Tomorrow$/ }).click();
  await panel.locator("[data-fu-save]").click();
  await p.waitForFunction(() => !document.querySelector("[data-fu-panel]"), null, { timeout: 15000 });
  ok(await panel.count() === 0 && /logged/i.test(await rowU1.textContent()), `${W} plain Save closes the panel, U1 ✓ logged`);
  const s1 = await sql1(`SELECT outcome::text o, next_follow_up nf, assigned_to::int a, note, ptp_amount_paise amt FROM collection_call WHERE loan_id=$1 ORDER BY id DESC LIMIT 1`, [U1.id]);
  ok(s1.o === "no_answer" && s1.nf === addDays(today, 1) && s1.a === Number(NAG) && s1.note == null && s1.amt == null, `${W} DB: U1 no answer, next tomorrow, assigned to me — nothing carried over from U2's form`);
  await p.locator(".fu-pill", { hasText: /^Tomorrow/ }).click();
  await p.waitForFunction((no) => !document.querySelector(`[data-fu-row="${no}"]`), U2.loan_no, { timeout: 15000 });
  await p.waitForSelector(`[data-fu-row="${U1.loan_no}"]`, { timeout: 15000 });
  ok(await rowU1.count() === 1 && await rowU2.count() === 0 && !/logged/i.test(await rowU1.textContent()), `${W} Tomorrow preset: U1 moved there (fresh list, no ✓ mark)`);
  await p.locator(".fu-pill", { hasText: /^Today/ }).click();
  await p.waitForTimeout(1500);
  ok(await p.locator(`[data-fu-done="${U1.loan_no}"]`).count() === 1 && await p.locator(`[data-fu-done="${U2.loan_no}"]`).count() === 1, `${W} Today after reload: both logs under Done`);

  // ── loan page section on U3 ──
  await p.goto(`${BASE}/loans/${U3.id}`, { waitUntil: "networkidle" });
  await p.waitForSelector("[data-fu-section]", { timeout: 20000 });
  const sec = p.locator("[data-fu-section]");
  ok(/1 done · 1 due/i.test(await sec.textContent()) && (await sec.textContent()).includes(`due ${dmy(addDays(today, 2))}`), `${W} loan page section: '1 done · 1 due', banner names the day`);
  ok(await p.locator("text=More on this loan").count() === 1 && await p.locator("text=/Payment (&|and) charge history/i").count() >= 1, `${W} loan page: 'More on this loan' and payment history intact`);
  await sec.locator("[data-fu-open]").click();
  await sec.locator(".fu-pill", { hasText: /^Paid/ }).click();
  await sec.locator("[data-fu-remark]").fill(`UI walk ${RUN} paid on loan page`);
  await sec.locator(".fu-pill", { hasText: /No further follow-up/ }).click();
  await sec.locator("[data-fu-save]").click();
  await p.waitForFunction(() => document.querySelector("[data-fu-section]")?.querySelectorAll("[data-fu-item]").length === 2, null, { timeout: 15000 });
  ok(/2 done/i.test(await sec.textContent()) && !/1 due/i.test(await sec.textContent()) && await sec.locator("[data-fu-form]").count() === 0, `${W} logged in place: '2 done', no due item, form closed`);
  await noScroll(p, `${W} loan page`);

  // ── the register ──
  await p.goto(`${BASE}/reports/followups`, { waitUntil: "networkidle" });
  await p.locator("button", { hasText: /Run report/ }).click();
  await p.waitForSelector("[data-fu-register]", { timeout: 20000 });
  const reg = p.locator("[data-fu-register]");
  ok(/Due in period/.test(await reg.textContent()) && /Promises/.test(await reg.textContent()), `${W} register runs: KPI tiles shown`);
  await reg.locator('[data-fu-rtab="promises"]').click();
  await p.waitForTimeout(400);
  ok((await reg.textContent()).includes(U2.loan_no) && /open/.test(await reg.textContent()), `${W} Promises tab lists U2's promise as open`);
  await reg.locator('[data-fu-rtab="staff"]').click();
  await p.waitForTimeout(400);
  ok(/Nagin/i.test(await reg.textContent()) && /Follow-ups logged/i.test(await reg.textContent()), `${W} By-staff tab tallies Nagin`);
  await noScroll(p, `${W} register`);

  await ctx.close();
}
await browser.close();
await pool.end();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
