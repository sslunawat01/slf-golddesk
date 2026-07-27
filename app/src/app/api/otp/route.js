import { NextResponse } from "next/server";
import { currentActor } from "@/lib/session.js";
import { one, audit, tx } from "@/lib/db.js";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mobile verification by OTP.
 *
 * The SMS gateway is not connected yet, so this runs in "manual" mode: the code
 * is shown to the operator on screen, who reads it to the customer standing at
 * the counter. That still proves the number was spoken aloud and confirmed.
 * When the gateway is wired in, only `sendSms()` changes — the flow, the API
 * and the stored evidence stay exactly as they are.
 *
 * Verification is NOT compulsory until then (see validateNewCustomer).
 */
const store = new Map();                       // mobile → { code, expires, attempts }
const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

async function sendSms(mobile, code) {
  if (!process.env.SMS_PROVIDER) return { sent: false, mode: "manual" };
  // TODO: provider call goes here; the rest of the flow does not change.
  return { sent: false, mode: "manual" };
}

export async function POST(req) {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ ok: false, reason: "Signed out" }, { status: 401 });
  const { action, mobile, code } = await req.json().catch(() => ({}));
  const m = String(mobile || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(m))
    return NextResponse.json({ ok: false, reason: "Enter a valid 10-digit mobile number" }, { status: 400 });

  if (action === "send") {
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    store.set(m, { code: otp, expires: Date.now() + TTL_MS, attempts: 0 });
    const sms = await sendSms(m, otp);
    return NextResponse.json({ ok: true, mode: sms.mode,
      // manual mode only: the operator reads this out; never returned once SMS is live
      manualCode: sms.sent ? undefined : otp,
      note: sms.sent ? "OTP sent by SMS" : "SMS gateway not connected — read this code to the customer" });
  }

  if (action === "verify") {
    const rec = store.get(m);
    if (!rec) return NextResponse.json({ ok: false, reason: "Ask for a code first" }, { status: 400 });
    if (Date.now() > rec.expires) { store.delete(m);
      return NextResponse.json({ ok: false, reason: "That code has expired — send a new one" }, { status: 400 }); }
    if (rec.attempts >= MAX_ATTEMPTS) { store.delete(m);
      return NextResponse.json({ ok: false, reason: "Too many wrong attempts — send a new code" }, { status: 429 }); }
    rec.attempts++;
    if (String(code || "").trim() !== rec.code)
      return NextResponse.json({ ok: false,
        reason: `Wrong code — ${MAX_ATTEMPTS - rec.attempts} attempt(s) left` }, { status: 400 });

    store.delete(m);
    return NextResponse.json({ ok: true, verifiedAt: new Date().toISOString() });
  }

  return NextResponse.json({ ok: false, reason: "Unknown action" }, { status: 400 });
}
