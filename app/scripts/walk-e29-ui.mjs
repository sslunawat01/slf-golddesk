/**
 * Walk: E29 browser layer — the disburser ticks an UNVERIFIED account,
 * presses Pay, sees the pop-up with the account IN FULL and the recent-change
 * warning, presses Go back (nothing is paid), then Pay → Yes (paid, signed).
 * Run TWICE.  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/walk-e29-ui.mjs
 */
import pg from "pg";
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const BASE = "http://localhost:3000";
const pool = new pg.Pool({ connectionString: "postgres://slf:slf@localhost:5432/golddesk" });
const sql1 = async (t, p) => (await pool.query(t, p)).rows[0];
let failures = 0;
const ok = (c, l) => { console.log((c ? "PASS " : "FAIL ") + l); if (!c) failures++; };

// a fresh approved clone of file 77 + a fresh unverified account changed "2 days ago"
const f = await sql1(`INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status, rate_date,
    base_paise_snapshot, funding_paise_snapshot, scheme_version_id, requested_paise, purpose, borrower_present,
    presence_photo_id, valuer1_id, valuer2_id, created_by)
  SELECT 'APP-E29UI-' || floor(random()*1e9)::bigint, entity_id, branch_id, customer_id, 'approved', rate_date,
    base_paise_snapshot, funding_paise_snapshot, scheme_version_id, requested_paise, purpose, borrower_present,
    presence_photo_id, valuer1_id, valuer2_id, created_by FROM loan_application WHERE id=77 RETURNING id, customer_id`);
for (const t of ["appraisal_item (application_id, item_id, qty, gross_mg, stone_mg, purity_id, purity_pct_snapshot, market_paise, funding_paise, narration) SELECT $1, item_id, qty, gross_mg, stone_mg, purity_id, purity_pct_snapshot, market_paise, funding_paise, narration FROM appraisal_item",
                 "application_photo (application_id, file_id, ord) SELECT $1, file_id, ord FROM application_photo",
                 "application_rate (application_id, metal_id, base_paise, funding_paise) SELECT $1, metal_id, base_paise, funding_paise FROM application_rate"])
  await pool.query(`INSERT INTO ${t} WHERE application_id=77`, [f.id]);
await pool.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
  VALUES ($1,'appraised','approved',1,'E29 UI walk clone')`, [f.id]);
const RUN = String(Date.now()).slice(-6);               // unique per run — reruns never collide
const unvNo = "6666" + String(Date.now()).slice(-8);
const unv = await sql1(`INSERT INTO customer_bank_account (customer_id, bank, account_no, ifsc, holder_name, verify_method)
  VALUES ($1, 'Popup Test Bank ' || $3, $2, 'SBIN0000386', 'Popup Holder', 'none') RETURNING id`, [f.customer_id, unvNo, RUN]);
await pool.query(`INSERT INTO audit_log (at, employee_id, entity_table, entity_id, action, before, after)
  VALUES (now() - interval '2 days', 1, 'customer_bank_account', $1, 'edit', $2, $3)`,
  [unv.id, JSON.stringify({ accountNo: "999900001234" }), JSON.stringify({ accountNo: unvNo, verificationCleared: true })]);

const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
p.on("pageerror", e => { console.log("PAGE ERROR:", e.message); failures++; });
await p.goto(`${BASE}/login`);
await p.fill("#u", "nagin.kothari"); await p.fill("#p", "Testpass123456");
await p.click('button[type="submit"]');
await p.waitForURL(/home|branch|login/, { timeout: 20000 });
await p.waitForTimeout(1200);
if (!p.url().includes("/home")) {                      // picker
  await p.locator("button", { hasText: /B3|Nashik/ }).first().click();
  await p.waitForURL("**/home", { timeout: 20000 });
}
// make sure he is acting at branch 3
const cur = await sql1(`SELECT acting_branch_id FROM session s JOIN employee e ON e.id=s.employee_id
  WHERE e.username='nagin.kothari' AND s.revoked_at IS NULL ORDER BY s.created_at DESC LIMIT 1`);
if (Number(cur.acting_branch_id) !== 3) {
  await p.evaluate(async () => { await fetch("/api/auth/branch", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ branchId: 3 }) }); });
}

await p.goto(`${BASE}/pledge/${f.id}`, { waitUntil: "networkidle" });
await p.locator("button", { hasText: /^3\b|Disbursement|disbursement →/ }).first().click();
await p.waitForTimeout(800);
const step3 = await p.innerText("body");
ok(/not verified — pay needs your confirmation/i.test(step3), "unverified account shows the amber 'pay needs your confirmation' tag");
ok(!/cannot receive/i.test(step3), "no screen still says 'cannot receive'");

await p.locator("select").filter({ has: p.locator("option", { hasText: /our account/ }) }).selectOption({ index: 1 });
await p.locator("button", { hasText: "Popup Test Bank " + RUN }).click();
const pay = p.locator("button", { hasText: /^Pay / });
ok(await pay.isEnabled(), "an unverified account can be ticked and Pay is enabled");
await pay.click();
await p.waitForTimeout(1200);
const pop = await p.innerText("body");
ok(/disbursing to an UNVERIFIED bank account/i.test(pop), "the pop-up appears");
ok(pop.includes(unvNo) && /SBIN0000386/.test(pop) && /Popup Holder/i.test(pop),
  "pop-up shows the account number IN FULL, the IFSC and the holder");
ok(/CHANGED on .* \(was …1234\)/i.test(pop), "pop-up shouts that the number was changed recently");
const none = await sql1(`SELECT count(*)::int AS n FROM loan WHERE application_id=$1`, [f.id]);
ok(none.n === 0, "while the pop-up is open, nothing has been paid");

await p.locator("button", { hasText: /^Go back$/ }).click();
await p.waitForTimeout(500);
const after = await sql1(`SELECT count(*)::int AS n FROM loan WHERE application_id=$1`, [f.id]);
ok(after.n === 0 && !/disbursing to an UNVERIFIED/i.test(await p.innerText("body")),
  "Go back closes the pop-up and pays nothing");

await pay.click();
await p.waitForTimeout(1200);
await p.locator("button", { hasText: /Pay without verifying/ }).click();
await p.waitForTimeout(2500);
const done = await p.innerText("body");
const leg = await sql1(`SELECT l.loan_no, dl.unverified_ack_by, e.username FROM loan l
  JOIN disbursement d ON d.loan_id=l.id JOIN disbursement_leg dl ON dl.disbursement_id=d.id AND dl.kind='bank'
  LEFT JOIN employee e ON e.id=dl.unverified_ack_by WHERE l.application_id=$1`, [f.id]);
ok(/loan activated/i.test(done) && leg?.loan_no && done.includes(leg.loan_no), `Yes → loan ${leg?.loan_no} activated on screen`);
ok(leg?.username === "nagin.kothari", `the payout is signed by the person who pressed Yes (${leg?.username})`);

// ═════ B · E29b: verify FROM the pop-up by document, then pay as verified ═════
// (photo upload goes to S3, unreachable from this sandbox — /api/files is stood
//  in for with an existing photo record; everything after the upload is real)
const g = await sql1(`INSERT INTO loan_application (app_no, entity_id, branch_id, customer_id, status, rate_date,
    base_paise_snapshot, funding_paise_snapshot, scheme_version_id, requested_paise, purpose, borrower_present,
    presence_photo_id, valuer1_id, valuer2_id, created_by)
  SELECT 'APP-E29B-' || floor(random()*1e9)::bigint, entity_id, branch_id, customer_id, 'approved', rate_date,
    base_paise_snapshot, funding_paise_snapshot, scheme_version_id, requested_paise, purpose, borrower_present,
    presence_photo_id, valuer1_id, valuer2_id, created_by FROM loan_application WHERE id=77 RETURNING id`);
for (const t of ["appraisal_item (application_id, item_id, qty, gross_mg, stone_mg, purity_id, purity_pct_snapshot, market_paise, funding_paise, narration) SELECT $1, item_id, qty, gross_mg, stone_mg, purity_id, purity_pct_snapshot, market_paise, funding_paise, narration FROM appraisal_item",
                 "application_photo (application_id, file_id, ord) SELECT $1, file_id, ord FROM application_photo",
                 "application_rate (application_id, metal_id, base_paise, funding_paise) SELECT $1, metal_id, base_paise, funding_paise FROM application_rate"])
  await pool.query(`INSERT INTO ${t} WHERE application_id=77`, [g.id]);
await pool.query(`INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
  VALUES ($1,'appraised','approved',1,'E29b UI walk clone')`, [g.id]);
const docNo = "7777" + String(Date.now()).slice(-8);
const docAcc = await sql1(`INSERT INTO customer_bank_account (customer_id, bank, account_no, ifsc, holder_name, verify_method)
  VALUES ($1, 'Docverify Bank ' || $3, $2, 'SBIN0000386', 'Doc Holder', 'none') RETURNING id`, [f.customer_id, docNo, RUN]);
const anyFile = await sql1(`SELECT id FROM file_object ORDER BY id LIMIT 1`);
await p.route("**/api/files", r => r.fulfill({ status: 200, contentType: "application/json",
  body: JSON.stringify({ ok: true, fileId: Number(anyFile.id), bytes: 120000 }) }));

await p.goto(`${BASE}/pledge/${g.id}`, { waitUntil: "networkidle" });
await p.locator("button", { hasText: /^3\b|Disbursement|disbursement →/ }).first().click();
await p.waitForTimeout(800);
await p.locator("select").filter({ has: p.locator("option", { hasText: /our account/ }) }).selectOption({ index: 1 });
await p.locator("button", { hasText: "Docverify Bank " + RUN }).click();
await p.locator("button", { hasText: /^Pay / }).click();
await p.waitForTimeout(1200);
const apiBtn = p.locator("button", { hasText: /Verify by bank API/ });
ok(await apiBtn.count() === 1 && !(await apiBtn.isEnabled()),
  "pop-up shows 'Verify by bank API', switched off (no provider connected)");
const docBtn = p.locator("button", { hasText: /Verify by document/ });
ok(!(await docBtn.isEnabled()), "'Verify by document' waits for a photo");
await p.locator('input[type="file"]').first().setInputFiles({ name: "cheque.png", mimeType: "image/png",
  buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
await p.waitForTimeout(1500);
ok(await docBtn.isEnabled(), "after the photo, 'Verify by document' is enabled");
await docBtn.click();
// two server calls (attach proof → verify); wait for the screen to say so, never a fixed sleep
await p.waitForSelector("text=verified ✓ — paid as a verified account", { timeout: 20000 }).catch(() => {});
const ver = await sql1(`SELECT verified_at, verify_method::text AS vm, cheque_file_id FROM customer_bank_account WHERE id=$1`, [docAcc.id]);
ok(ver.verified_at && ver.vm === "cheque_photo" && Number(ver.cheque_file_id) === Number(anyFile.id),
  `the account is now VERIFIED in the database by cheque photo (method ${ver.vm})`);
const proofRow = await sql1(`SELECT count(*)::int AS n FROM customer_bank_proof WHERE account_id=$1 AND removed_at IS NULL`, [docAcc.id]);
ok(proofRow.n === 1, "the photo joined the account's proof gallery");
const payNow = p.locator("button", { hasText: /All accounts verified — pay now/ });
ok(await payNow.count() === 1, "the button turns into 'All accounts verified — pay now'");
await payNow.click();
await p.waitForTimeout(2500);
const legB = await sql1(`SELECT l.loan_no, dl.unverified_ack_by FROM loan l
  JOIN disbursement d ON d.loan_id=l.id JOIN disbursement_leg dl ON dl.disbursement_id=d.id AND dl.kind='bank'
  WHERE l.application_id=$1`, [g.id]);
ok(legB?.loan_no && legB.unverified_ack_by === null && /loan activated/i.test(await p.innerText("body")),
  `paid as a VERIFIED account — loan ${legB?.loan_no}, nobody had to sign for risk`);

await browser.close(); await pool.end();
console.log(failures === 0 ? "\nE29 UI WALK PASS" : `\nE29 UI WALK FAIL — ${failures}`);
process.exit(failures ? 1 : 0);
