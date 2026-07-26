/**
 * Forward-only migration runner.
 *   node scripts/migrate.mjs          apply anything new
 *   node scripts/migrate.mjs --status list applied/pending
 * Each file in db/migrations runs once, inside its own transaction.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const dir = new URL("../../db/migrations/", import.meta.url).pathname;
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
    await pool.end(); process.exit(1);
  } finally { client.release(); }
}
console.log(applied ? `${applied} migration(s) applied` : "database already up to date");
await pool.end();
