/**
 * Login ticket (E28, 14 Oct 2026) — the proof that the password step
 * happened before the branch picker may mint a session.
 *   node scripts/test-loginticket.mjs
 */
process.env.DATABASE_URL ??= "postgres://test@localhost/test";
const { issueLoginTicket, readLoginTicket } = await import("../src/lib/loginticket.js");

let pass = 0, fail = 0;
const t = (cond, label) => { if (cond) pass++; else { fail++; console.log("FAIL " + label); } };

const now = 1_800_000_000_000;
const tk = issueLoginTicket(7, now);

t(readLoginTicket(tk, now) === 7, "genuine ticket reads back its employee");
t(readLoginTicket(tk, now + 4 * 60_000) === 7, "still good at 4 minutes");
t(readLoginTicket(tk, now + 5 * 60_000 + 1) === null, "dead just after 5 minutes");

const [id, exp, sig] = tk.split(".");
t(readLoginTicket(`1.${exp}.${sig}`, now) === null, "employee id swapped to the owner → refused");
t(readLoginTicket(`${id}.${Number(exp) + 3_600_000}.${sig}`, now) === null, "expiry pushed out → refused");
t(readLoginTicket(`${id}.${exp}.${sig.slice(0, -1)}A`, now) === null, "signature altered → refused");
t(readLoginTicket(`${id}.${exp}.`, now) === null, "signature missing → refused");
for (const junk of [undefined, null, "", "7", "7.9", "abc.def.ghi", 7, {}, "7.9.x.y"])
  t(readLoginTicket(junk, now) === null, `junk ${JSON.stringify(junk)} → refused`);

t(issueLoginTicket(7, now) === tk, "deterministic for the same moment");
t(issueLoginTicket(8, now) !== tk, "a different employee gets a different ticket");

// a ticket made under one database's key is worthless under another's
const other = process.env.DATABASE_URL;
process.env.DATABASE_URL = "postgres://someone-else@elsewhere/db";
t(readLoginTicket(tk, now) === null, "a ticket from another server's key → refused");
process.env.DATABASE_URL = other;

// no key → fail CLOSED, never a ticket signed with an empty key
delete process.env.DATABASE_URL;
let threw = false;
try { issueLoginTicket(7, now); } catch { threw = true; }
t(threw, "missing DATABASE_URL → issuing throws (fails closed)");
let threw2 = false;
try { readLoginTicket(tk, now); } catch { threw2 = true; }
t(threw2, "missing DATABASE_URL → reading throws (fails closed)");
process.env.DATABASE_URL = other;

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
