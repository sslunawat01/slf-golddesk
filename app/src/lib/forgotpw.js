/**
 * SLF GoldDesk — forgot-password OTP rules (pure functions, no I/O)
 *
 * TESTING MODE (W7): until an SMS gateway is chosen (№27, MSG91 suggested),
 * the code is DISPLAYED on the very screen that asks for it. That is zero
 * security by design and is recorded as testing weakening W7 — it must be
 * flipped to real SMS before any staff besides the owner can log in. The
 * seam is one function in the API route (sendSms); nothing here changes.
 */

export const OTP_TTL_MS = 5 * 60 * 1000;   // same 5 minutes as the customer-mobile OTP
export const OTP_MAX_ATTEMPTS = 5;         // then the code dies; ask for a fresh one

/** What did the person type — a mobile number or a username/emp-code? */
export function classifyWho(input) {
  const s = String(input || "").trim();
  if (!s) return { ok: false, reason: "Type your username, employee code or mobile number" };
  const digits = s.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return { ok: true, kind: "mobile", value: digits };
  if (s.length < 3) return { ok: false, reason: "That looks too short to be a username" };
  return { ok: true, kind: "username", value: s.toLowerCase() };
}

/** A fresh 6-digit code. rng injectable for tests. */
export function newOtp(rng = Math.random) {
  return String(Math.floor(100000 + rng() * 900000));
}

/**
 * Judge one entry attempt against a stored record.
 * rec: { code, expiresAt, attempts } — attempts BEFORE this try.
 * Returns { ok:true } or { ok:false, reason, dead } — dead means the record
 * must be discarded (expired or attempts exhausted).
 */
export function judgeAttempt(rec, typedCode, nowMs) {
  if (!rec) return { ok: false, dead: false, reason: "Ask for a code first" };
  if (nowMs > rec.expiresAt)
    return { ok: false, dead: true, reason: "That code has expired — ask for a new one" };
  const used = rec.attempts + 1;
  if (used > OTP_MAX_ATTEMPTS)
    return { ok: false, dead: true, reason: "Too many wrong attempts — ask for a new code" };
  if (String(typedCode || "").trim() !== rec.code) {
    const left = OTP_MAX_ATTEMPTS - used;
    return left <= 0
      ? { ok: false, dead: true, reason: "Too many wrong attempts — ask for a new code" }
      : { ok: false, dead: false, reason: `Wrong code — ${left} attempt(s) left` };
  }
  return { ok: true };
}

/** "Sarita Patil" → "Sa••••a P•••l" — enough to confirm, not enough to leak. */
export function maskName(full) {
  return String(full || "").split(/\s+/).filter(Boolean).map(w =>
    w.length === 1 ? w :
    w.length === 2 ? w[0] + "•" :
    w[0] + w[1] + "•".repeat(Math.max(1, w.length - 3)) + w[w.length - 1]
  ).join(" ");
}
