import { NextResponse } from "next/server";
import { one, q } from "@/lib/db.js";
import { setPassword } from "@/lib/session.js";
import { checkPasswordPolicy } from "@/lib/password.js";
import { classifyWho, newOtp, judgeAttempt, maskName, OTP_TTL_MS } from "@/lib/forgotpw.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Forgot password by OTP. Unauthenticated by nature.
 *
 * E28 (14 Oct 2026) — W7 CLOSED. Testing mode returned the code to the
 * browser, so anyone could reset ANY account (the owner's included). The
 * owner's own recorded rule was "acceptable only while the owner is the sole
 * user"; eleven staff accounts now exist, so that condition has passed.
 * The code is NEVER returned to the browser any more. Until sendSms()
 * really delivers (№27, provider pending), self-service reset refuses up
 * front — BEFORE looking the person up, so it no longer reveals which
 * usernames exist — and points to the administrator's Reset password
 * (Settings → Employees). When SMS lands, nothing else needs to change.
 */
const store = new Map();                    // employee id → { code, expiresAt, attempts }

/** True only once a provider is configured AND sendSms() is really wired. */
function smsLive() {
  return !!process.env.SMS_PROVIDER && SMS_WIRED;
}
const SMS_WIRED = false;   // flip to true in the same patch that implements the provider call

async function sendSms(mobile, code) {
  if (!process.env.SMS_PROVIDER) return { sent: false, mode: "manual" };
  // TODO: provider call goes here; the rest of the flow does not change.
  return { sent: false, mode: "manual" };
}

async function findEmployee(who) {
  if (who.kind === "mobile")
    return one(`SELECT id, username, full_name, mobile, status FROM employee
                 WHERE regexp_replace(coalesce(mobile,''),'\\D','','g') = $1
                   AND status = 'active' ORDER BY id LIMIT 1`, [who.value]);
  return one(`SELECT id, username, full_name, mobile, status FROM employee
               WHERE (lower(username) = $1 OR lower(emp_code) = $1)
                 AND status = 'active' LIMIT 1`, [who.value]);
}

export async function POST(req) {
  const { action, who: whoRaw, code, password } = await req.json().catch(() => ({}));
  if (!smsLive())
    return NextResponse.json({ ok: false,
      reason: "Self-service password reset is switched off until SMS is connected. Ask your administrator to reset your password (Settings → Employees → Reset password)." },
      { status: 503 });
  const who = classifyWho(whoRaw);
  if (!who.ok) return NextResponse.json({ ok: false, reason: who.reason }, { status: 400 });

  const emp = await findEmployee(who);
  if (!emp) return NextResponse.json(
    { ok: false, reason: "No active employee matches that — check the spelling, or ask the admin to reset your password" },
    { status: 404 });

  if (action === "send") {
    const otp = newOtp();
    store.set(Number(emp.id), { code: otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
    const sms = await sendSms(emp.mobile, otp);
    if (!sms.sent) {                     // never fall back to showing the code (W7)
      store.delete(Number(emp.id));
      return NextResponse.json({ ok: false,
        reason: "The SMS could not be sent — ask your administrator to reset your password" }, { status: 503 });
    }
    return NextResponse.json({ ok: true, mode: sms.mode, name: maskName(emp.full_name),
      note: "OTP sent by SMS to your registered mobile" });
  }

  if (action === "reset") {
    const rec = store.get(Number(emp.id));
    const j = judgeAttempt(rec, code, Date.now());
    if (!j.ok) {
      if (j.dead) store.delete(Number(emp.id));
      else if (rec) rec.attempts++;
      return NextResponse.json({ ok: false, reason: j.reason }, { status: 400 });
    }
    const pol = checkPasswordPolicy(password, emp.username);
    if (!pol.ok) return NextResponse.json(
      { ok: false, reason: "Password does not meet the requirements", checks: pol.checks }, { status: 400 });
    store.delete(Number(emp.id));
    await setPassword(emp.id, password);       // hashes + revokes every open session
    await q(`INSERT INTO audit_log (employee_id, entity_table, entity_id, action, after)
             VALUES ($1,'employee',$1,'password_reset_otp',$2)`,
      [emp.id, JSON.stringify({ via: "otp", mode: "sms" })]);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
}
