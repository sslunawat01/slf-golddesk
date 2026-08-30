/**
 * ONE-TIME catch-up (30 Aug 2026): close the three 28-Aug branch days left
 * open when the auto day-end timers failed to launch (/usr/bin/node did not
 * exist — E23). Mirrors auto-daycycle.mjs `end` but for business_date
 * 2026-08-28: expected = that day's opening + its own cash flows, counted
 * taken as expected, stamped employee 1 with a catch-up reason.
 *
 * Deliberately does NOT cancel undisbursed applications — tonight's fixed
 * auto-end (23:59 IST) applies №7 to every branch whose day began, giving
 * the owner the afternoon to disburse anything he wants to keep.
 *
 * Refuses to run twice (no open rows → prints and exits 0).
 */
import fs from "node:fs";
import pg from "pg";

const D = "2026-08-28";
const SYSTEM_EMPLOYEE = 1;

const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// E23: receipts sit behind the entity RLS wall — without app.entity_ids the
// flow sums are silently zero. One client, context set session-wide.
const cx = await pool.connect();
await cx.query("SELECT set_config('app.entity_ids', 'ALL', false)");
const one = async (t, p) => (await cx.query(t, p)).rows[0] || null;

const { rows: open } = await cx.query(
  `SELECT dc.id, dc.branch_id, b.code, b.name, dc.begin_counted_paise
     FROM day_cycle dc JOIN branch b ON b.id = dc.branch_id
    WHERE dc.business_date = $1 AND dc.begin_signed_at IS NOT NULL
      AND dc.end_signed_at IS NULL
    ORDER BY dc.branch_id`, [D]);
if (!open.length) { console.log(`nothing to do — no open ${D} days`); cx.release(); await pool.end(); process.exit(0); }

for (const cyc of open) {
  const rec = await one(
    `SELECT coalesce(sum(amount_paise),0)::bigint AS p FROM receipt
      WHERE branch_id=$1 AND business_date=$2 AND mode='cash'`, [cyc.branch_id, D]);
  const dis = await one(
    `SELECT coalesce(sum(dl.amount_paise),0)::bigint AS p
       FROM disbursement_leg dl
       JOIN disbursement d ON d.id=dl.disbursement_id
       JOIN loan l ON l.id=d.loan_id
      WHERE l.branch_id=$1 AND d.created_at::date=$2 AND dl.kind='cash'`, [cyc.branch_id, D]);
  const expected = Number(cyc.begin_counted_paise) + Number(rec.p) - Number(dis.p);
  const cl = cx;
  try {
    await cl.query("BEGIN");
    await cl.query(
      `UPDATE day_cycle SET end_expected_paise=$2, end_counted_paise=$2,
         end_variance_paise=0,
         end_reason='catch-up day-end 30 Aug — 28 Aug left open when the auto-end timer failed to launch (E23)',
         end_signed_by=$3, end_signed_at=now()
       WHERE id=$1 AND end_signed_at IS NULL`, [cyc.id, expected, SYSTEM_EMPLOYEE]);
    await cl.query(
      `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, after)
       VALUES ($1,$2,'day_cycle',$3,'day_end_catchup',$4)`,
      [SYSTEM_EMPLOYEE, cyc.branch_id, Number(cyc.id), JSON.stringify({
        businessDate: D, expectedPaise: expected, mode: "catchup_20260830" })]);
    await cl.query("COMMIT");
    console.log(`closed ${cyc.code} ${cyc.name} (${D}) at ₹${(expected / 100).toLocaleString("en-IN")}`);
  } catch (e) { await cl.query("ROLLBACK"); console.error(`${cyc.code} FAILED:`, e.message); }
}
cx.release();
await pool.end();
