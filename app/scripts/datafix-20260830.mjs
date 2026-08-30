/**
 * ONE-TIME data fixes ordered by the owner, 30 Aug 2026 (ledger rulings):
 *  №4  deactivate the "Deolali" safe (matched by label/location, printed
 *      before touching; soft — active=false, movements untouched)
 *  №9  GL2070 superseded test versions carry effective_to BEFORE
 *      effective_from (28 Aug → 27 Aug) — set end = start on exactly those
 *  №11 cancel the walk applications parked on the Head Office branch —
 *      day cycles never run for HO, so №7 can never reach them
 * Every change prints what it touched and writes an audit row.
 * Safe to re-run: each step matches only broken/open rows.
 */
import fs from "node:fs";
import pg from "pg";

const SYSTEM_EMPLOYEE = 1;
const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cx = await pool.connect();               // entity RLS wall (E23)
await cx.query("SELECT set_config('app.entity_ids', 'ALL', false)");

// —— №4 · Deolali safe ————————————————————————————————————————————————
const { rows: safes } = await cx.query(
  `SELECT s.id, s.label, s.location_note, b.code, b.name
     FROM safe s JOIN branch b ON b.id=s.branch_id
    WHERE s.active AND (s.label ILIKE '%deolali%' OR s.location_note ILIKE '%deolali%')`);
if (!safes.length) console.log("№4: no active safe matches 'Deolali' — nothing deactivated (tell Claude where it appears)");
for (const s of safes) {
  await cx.query("BEGIN");
  await cx.query(`UPDATE safe SET active=FALSE, updated_by=$2 WHERE id=$1`, [s.id, SYSTEM_EMPLOYEE]);
  await cx.query(
    `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
     VALUES ($1,NULL,'safe',$2,'safe_deactivated',$3)`,
    [SYSTEM_EMPLOYEE, s.id, JSON.stringify({ label: s.label, reason: "owner order 30 Aug 2026 — remove B2 Deolali safe" })]);
  await cx.query("COMMIT");
  console.log(`№4: deactivated safe "${s.label}" (${s.location_note || "—"}) at ${s.code} ${s.name}`);
}

// —— №9 · GL2070 windows where end < start ————————————————————————————
await cx.query("BEGIN");
const { rows: fixed } = await cx.query(
  `UPDATE scheme_version sv SET effective_to = sv.effective_from
     FROM scheme s
    WHERE s.id = sv.scheme_id AND s.code = 'GL2070'
      AND sv.effective_to < sv.effective_from
    RETURNING sv.id, sv.version_no, sv.effective_from::text AS effective_from`);
for (const v of fixed)
  await cx.query(
    `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
     VALUES ($1,NULL,'scheme_version',$2,'window_corrected',$3)`,
    [SYSTEM_EMPLOYEE, v.id, JSON.stringify({ versionNo: v.version_no,
      effectiveTo: v.effective_from, reason: "owner order 30 Aug 2026 — end date = start date on superseded test versions" })]);
await cx.query("COMMIT");
console.log(`№9: corrected ${fixed.length} GL2070 version window(s): ` +
  (fixed.map(v => `v${v.version_no}→${v.effective_from}`).join(", ") || "none needed"));
const { rows: others } = await cx.query(
  `SELECT s.code, sv.version_no FROM scheme_version sv JOIN scheme s ON s.id=sv.scheme_id
    WHERE sv.effective_to < sv.effective_from`);
if (others.length) console.log("№9 WARNING — other schemes also have end<start:", others.map(o => `${o.code} v${o.version_no}`).join(", "));

// —— №3 · silver purities become % of SILVER's own rate (A2) ——————————
// The legacy rows priced silver as a % of the GOLD rate (1.75 / 1.25).
// With silver carrying its own pair, the owner set purity 99 and 80.
// History is safe: zero silver appraisal items exist, and every item
// snapshots its purity_pct and rupee values on its own row anyway.
await cx.query("BEGIN");
const { rows: pfixed } = await cx.query(
  `UPDATE purity SET purity_pct = CASE WHEN karat ILIKE '%99%' THEN 99 ELSE 80 END
    WHERE metal_id = 2 AND active
      AND ((karat ILIKE '%99%' AND purity_pct <> 99)
        OR (karat ILIKE '%80%' AND purity_pct <> 80))
    RETURNING id, karat, purity_pct`);
for (const p of pfixed)
  await cx.query(
    `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
     VALUES ($1,NULL,'purity',$2,'purity_corrected',$3)`,
    [SYSTEM_EMPLOYEE, p.id, JSON.stringify({ karat: p.karat, purityPct: Number(p.purity_pct),
      reason: "owner order 30 Aug 2026 — silver purities as % of silver's own rate (A2)" })]);
await cx.query("COMMIT");
console.log(`№3: silver purities corrected: ${pfixed.map(p => `${p.karat}→${Number(p.purity_pct)}%`).join(", ") || "already correct"}`);

// —— №11 · walk applications on the Head Office branch ————————————————
await cx.query("BEGIN");
const { rows: doomed } = await cx.query(
  `SELECT la.id, la.app_no, la.status FROM loan_application la
     JOIN branch b ON b.id = la.branch_id
    WHERE b.is_ho AND la.status IN ('draft','appraised','pending_ho','approved')
    ORDER BY la.id FOR UPDATE`);
for (const d of doomed) {
  await cx.query(`UPDATE loan_application SET status='cancelled', updated_at=now(), updated_by=$2 WHERE id=$1`,
    [d.id, SYSTEM_EMPLOYEE]);
  await cx.query(
    `INSERT INTO loan_state_history (application_id, from_state, to_state, by_employee, note)
     VALUES ($1,$2,'cancelled',$3,'walk-test file on Head Office branch — cancelled on owner''s order (30 Aug 2026)')`,
    [d.id, d.status, SYSTEM_EMPLOYEE]);
}
if (doomed.length)
  await cx.query(
    `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
     VALUES ($1,NULL,'loan_application',NULL,'ho_walk_apps_cancelled',$2)`,
    [SYSTEM_EMPLOYEE, JSON.stringify({ appNos: doomed.map(x => x.app_no) })]);
await cx.query("COMMIT");
console.log(`№11: cancelled ${doomed.length} HO application(s): ${doomed.map(x => x.app_no).join(", ") || "none open"}`);

cx.release();
await pool.end();
