/**
 * ONE-TIME data fix, 14 Oct 2026 (E28).
 *
 * Head Office approval rows still 'waiting' for files that are no longer
 * pending at HO (they were cancelled — by the 30 Aug datafix №11 and by
 * day-end №7 — without their HO row being closed). Left alone, approving
 * one would have brought a cancelled file back to life; the approvals route
 * now refuses that (E28), and this closes the rows themselves so the HO
 * queue shows only real work.
 *
 * Marks them 'withdrawn' (decided_by stays NULL — nobody decided them),
 * writes one audit row each, prints every row it touched. Safe to re-run:
 * it only matches rows still in the broken state.
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
const cx = await pool.connect();
await cx.query("SELECT set_config('app.entity_ids', 'ALL', false)");     // entity RLS wall (E23)

try {
  await cx.query("BEGIN");
  const { rows } = await cx.query(
    `UPDATE ho_approval h SET status='withdrawn', decided_at=now(),
            reject_reason='closed by data fix 14 Oct 2026 — file was already ' || a.status::text
       FROM loan_application a
      WHERE a.id = h.application_id AND h.status='waiting' AND a.status <> 'pending_ho'
      RETURNING h.id, a.app_no, a.status::text AS app_status`);
  for (const r of rows)
    await cx.query(
      `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
       VALUES ($1, NULL, 'ho_approval', $2, 'stale_ho_row_withdrawn', $3)`,
      [SYSTEM_EMPLOYEE, r.id, JSON.stringify({ appNo: r.app_no, appStatus: r.app_status })]);
  await cx.query("COMMIT");
  console.log(rows.length
    ? `withdrew ${rows.length} stale HO row(s): ` + rows.map(r => `#${r.id} ${r.app_no} (${r.app_status})`).join(", ")
    : "nothing to do — no stale HO rows");
} catch (e) {
  await cx.query("ROLLBACK");
  console.error("FAILED, nothing changed:", e.message);
  process.exitCode = 1;
} finally {
  cx.release();
  await pool.end();
}
