/**
 * SLF GoldDesk — login ticket (E28, 14 Oct 2026)
 *
 * WHY: /api/auth/branch used to mint a full session for ANY employeeId sent
 * in the body — no password, no cookie. Two small numbers were enough to
 * become the owner. A multi-branch user's login is two steps (password →
 * pick branch), so step 2 must PROVE step 1 happened.
 *
 * The ticket is issued by /api/auth/login only AFTER authenticate() passed
 * (password, lockout, login window, active status, a role), and is good for
 * 5 minutes for that one employee. Stateless HMAC — no table, no migration.
 * The key is derived from DATABASE_URL, which carries the database password
 * and lives only in the server's .env; if it is missing we fail CLOSED.
 */
import crypto from "node:crypto";

const TTL_MS = 5 * 60_000;

function key() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("login ticket key unavailable");
  return crypto.createHash("sha256").update("slf-login-ticket-v1:" + base).digest();
}

const sign = (payload) =>
  crypto.createHmac("sha256", key()).update(payload).digest("base64url");

/** @returns {string} ticket for this employee, valid TTL_MS */
export function issueLoginTicket(employeeId, now = Date.now()) {
  const payload = `${Number(employeeId)}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** @returns {number|null} the employee id the ticket proves, or null */
export function readLoginTicket(ticket, now = Date.now()) {
  const m = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(String(ticket || ""));
  if (!m) return null;
  const payload = `${m[1]}.${m[2]}`;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(m[3]);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  if (Number(m[2]) < now) return null;                 // expired
  return Number(m[1]);
}
