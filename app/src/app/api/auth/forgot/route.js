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
 * TESTING MODE (recorded as weakening W7): no SMS gateway yet (№27), so the
 * code is RETURNED to the browser and shown on the screen. Anyone at the
 * login page can therefore reset any password — acceptable only while the
 * owner is the sole user. Before staff onboarding, wire sendSms() to the
 * chosen provider (MSG91 suggested); once it reports sent:true, the code is
 * never returned to the browser and W7 is closed. Nothing else changes.
 */
const store = new Map();                    // employee id → { code, expiresAt, attempts }

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
    return NextResponse.json({
      ok: true, mode: sms.mode, name: maskName(emp.full_name),
      // TESTING MODE ONLY — never returned once SMS is live (W7)
      manualCode: sms.sent ? undefined : otp,
      note: sms.sent ? "OTP sent by SMS to your registered mobile"
                     : "TESTING MODE — SMS gateway not connected. This code is shown here only until it is.",
    });
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
      [emp.id, JSON.stringify({ via: "otp", mode: "manual_testing" })]);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
}
