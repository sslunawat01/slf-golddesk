/**
 * Set (or reset) an employee password from the server command line.
 *   node scripts/set-password.mjs slunawat
 * Prompts hidden; never echoes the password; forces nothing else.
 */
import readline from "node:readline";
import { Writable } from "node:stream";
import pg from "pg";
import { hashPassword, checkPasswordPolicy } from "../src/lib/password.js";
import fs from "node:fs";

// load .env from the parent folder (…/slf/.env)
for (const line of fs.readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}

const username = process.argv[2];
if (!username) { console.error("usage: node scripts/set-password.mjs <username>"); process.exit(1); }

const muted = new Writable({ write(c, e, cb) { cb(); } });
function ask(prompt) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stdout.write(prompt);
    rl.question("", (a) => { rl.close(); process.stdout.write("\n"); res(a); });
  });
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query("SELECT id, username, full_name FROM employee WHERE lower(username)=lower($1)", [username]);
if (!rows.length) { console.error(`no employee with username "${username}"`); process.exit(1); }
const emp = rows[0];

const p1 = await ask(`New password for ${emp.full_name} (${emp.username}): `);
const p2 = await ask("Repeat: ");
if (p1 !== p2) { console.error("passwords do not match"); process.exit(1); }
const pol = checkPasswordPolicy(p1, emp.username);
if (!pol.ok) { console.error("password rejected:"); pol.checks.filter(c => !c.pass).forEach(c => console.error("  ✗ " + c.label)); process.exit(1); }

await pool.query("UPDATE employee SET password_hash=$2, force_change=FALSE, updated_at=now() WHERE id=$1",
  [emp.id, hashPassword(p1)]);
await pool.query("UPDATE session SET revoked_at=now() WHERE employee_id=$1 AND revoked_at IS NULL", [emp.id]);
console.log(`✓ password set for ${emp.username}`);
await pool.end();
