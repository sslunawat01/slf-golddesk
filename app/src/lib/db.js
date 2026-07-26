/**
 * SLF GoldDesk — database access
 * One pool, explicit SQL. The schema (db/schema.sql) is the single source of
 * truth; we do not duplicate it in an ORM model that can silently drift.
 */
import pg from "pg";

// money arrives as BIGINT — read it as a JS number (safe: paise up to 9e15)
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// numeric → number (rates/percentages only; money is never numeric in our schema)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// DATE → 'YYYY-MM-DD' string, never a timezone-shifted Date object
pg.types.setTypeParser(1082, (v) => v);

let pool;
export function db() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "golddesk",
    });
    pool.on("error", (e) => console.error("[db] idle client error", e));
  }
  return pool;
}

/** Simple query. */
export async function q(text, params = []) {
  const res = await db().query(text, params);
  return res.rows;
}
export async function one(text, params = []) {
  const rows = await q(text, params);
  return rows[0] ?? null;
}

/**
 * Transaction with RLS context. Every business write goes through this so the
 * entity wall is always set — missing context means the policies return zero rows.
 * @param {(client: pg.PoolClient) => Promise<any>} fn
 * @param {{entityIds?: number[] | "ALL"}} [opts]
 */
export async function tx(fn, opts = {}) {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const ctx = opts.entityIds === "ALL" ? "ALL" : (opts.entityIds || []).join(",");
    await client.query("SELECT set_config('app.entity_ids', $1, true)", [ctx]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Issue a gapless business number inside the caller's transaction. */
export async function issueNumber(client, { entityId, branchId, docType, fy }) {
  const { rows } = await client.query(
    "SELECT issue_number($1,$2,$3::series_doc,$4) AS no",
    [entityId, branchId, docType, fy]);
  return rows[0].no;
}

/** Append an audit row. Called inside the same transaction as the fact. */
export async function audit(client, { employeeId, branchId, table, entityId, action, before, after, requestId }) {
  await client.query(
    `INSERT INTO audit_log (employee_id, branch_id, entity_table, entity_id, action, before, after, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [employeeId ?? null, branchId ?? null, table, entityId ?? null, action,
     before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, requestId ?? null]);
}
