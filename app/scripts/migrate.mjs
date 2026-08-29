/**
 * Forward-only migration runner.
 *   node scripts/migrate.mjs          apply anything new
 *   node scripts/migrate.mjs --status list applied/pending
 * Each file in db/migrations runs once, inside its own transaction.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const envPath = [new URL("../../.env", import.meta.url).pathname,
                 new URL("../.env", import.meta.url).pathname].find(f => fs.existsSync(f));
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
// prefer the folder shipped with the app; fall back to the repo-level one
const candidates = [new URL("../db/migrations/", import.meta.url).pathname,
                    new URL("../../db/migrations/", import.meta.url).pathname];
const dir = candidates.find(d => fs.existsSync(d)) || candidates[0];
console.log("migrations folder:", dir);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migration (
  filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const { rows } = await pool.query("SELECT filename FROM schema_migration");
const done = new Set(rows.map(r => r.filename));
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort() : [];

if (process.argv.includes("--status")) {
  files.forEach(f => console.log((done.has(f) ? "✓ applied " : "· pending ") + f));
  await pool.end(); process.exit(0);
}

let applied = 0;
for (const f of files) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  const client = await pool.connect();
  try {
    await client.query(sql);
    await client.query("INSERT INTO schema_migration (filename) VALUES ($1)", [f]);
    console.log("✓ applied", f); applied++;
  } catch (e) {
    console.error("✗ FAILED", f, "\n ", e.message);
    await client.query("ROLLBACK").catch(() => {});
    // E21b: release BEFORE ending the pool — pool.end() waits for checked-out
    // clients, and the old order deadlocked here forever after any failure
    // (the owner paid 10 silent minutes per attempt to learn this).
    client.release();
    await pool.end().catch(() => {});
    process.exit(1);
  } finally { try { client.release(); } catch {} }
}
console.log(applied ? `${applied} migration(s) applied` : "database already up to date");
await pool.end();
