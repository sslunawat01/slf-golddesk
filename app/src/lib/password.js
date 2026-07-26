/**
 * SLF GoldDesk — password hashing & password policy
 * Pure Node crypto (scrypt). No native modules, no external dependencies:
 * one less thing to break on a server upgrade in year 6.
 *
 * Stored format:  scrypt$N$r$p$<salt-b64>$<hash-b64>
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

const N = 16384, R = 8, P = 1, KEYLEN = 64;

/** Hash a plaintext password for storage. */
export function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Constant-time verify. Returns false for any malformed/legacy value. */
export function verifyPassword(plain, stored) {
  try {
    if (typeof stored !== "string" || !stored.startsWith("scrypt$")) return false;
    const [, n, r, p, saltB64, hashB64] = stored.split("$");
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = scryptSync(plain, salt, expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}

/** Session tokens: random secret to the browser, only its SHA-256 stored in the DB. */
export function newSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256(token) };
}
export function sha256(s) { return createHash("sha256").update(s).digest("hex"); }

/**
 * Password requirements (mirrored by the UI checklist).
 * @returns {{ok:boolean, checks:{id:string,label:string,pass:boolean}[]}}
 */
export function checkPasswordPolicy(plain, username = "") {
  const checks = [
    { id: "len",  label: "at least 10 characters",       pass: (plain || "").length >= 10 },
    { id: "num",  label: "one number",                    pass: /\d/.test(plain || "") },
    { id: "alpha",label: "one letter",                    pass: /[a-zA-Z]/.test(plain || "") },
    { id: "user", label: "not the same as your username",
      pass: !!plain && plain.toLowerCase() !== (username || "").toLowerCase() },
  ];
  return { ok: checks.every(c => c.pass), checks };
}
