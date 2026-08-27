"use client";
import { useState } from "react";

/* Same dark-vault chrome as LoginClient. Three steps on one card:
   who → code + new password → done. TESTING MODE: the code is shown
   in an amber box on this very screen until the SMS gateway (№27/W7). */

const S = {
  page:  { minHeight: "100dvh", background: "#0c231b", display: "flex",
           flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "30px 16px" },
  brand: { fontSize: 26, fontWeight: 900, letterSpacing: "-.5px", color: "#fff", textAlign: "center" },
  sub:   { color: "#5f8f7b", fontSize: 12.5, fontWeight: 600, textAlign: "center", marginTop: 3 },
  card:  { width: "min(420px,100%)", background: "#123227", border: "1px solid #1b4434",
           borderRadius: 18, padding: 22, marginTop: 22 },
  label: { display: "block", fontSize: 11, fontWeight: 800, letterSpacing: ".1em",
           textTransform: "uppercase", color: "#5f8f7b", marginBottom: 6 },
  input: { width: "100%", height: 46, border: "1px solid #2c5a46", background: "#0c231b",
           color: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 15, outline: "none" },
  mono:  { fontFamily: "ui-monospace,'SF Mono',Consolas,Menlo,monospace", letterSpacing: ".02em" },
  btn:   { width: "100%", height: 48, borderRadius: 11, fontWeight: 800, fontSize: 15,
           cursor: "pointer", border: 0, background: "#e0a63a", color: "#0c231b" },
  ghost: { background: "transparent", border: "1px solid #2c5a46", color: "#cfe4da",
           borderRadius: 10, height: 46, padding: "0 14px", fontWeight: 800, cursor: "pointer" },
  chip:  (tone) => ({
           borderRadius: 10, padding: "9px 13px", fontSize: 12.5, fontWeight: 700, lineHeight: 1.45,
           background: tone === "bad" ? "#fbe6e2" : tone === "warn" ? "#fdf1d8" : "#e2f2e9",
           color:      tone === "bad" ? "#b03426" : tone === "warn" ? "#a06407" : "#1e7a4f" }),
  otpBox:{ marginTop: 14, borderRadius: 12, border: "1px dashed #a06407", background: "#fdf1d8",
           padding: "12px 14px", textAlign: "center" },
  foot:  { color: "#43604f", fontSize: 11.5, marginTop: 16, textAlign: "center" },
};

export default function Forgot() {
  const [step, setStep] = useState("who");          // who | reset | done
  const [who, setWho] = useState("");
  const [name, setName] = useState("");
  const [shownCode, setShownCode] = useState(null); // TESTING MODE only
  const [code, setCode] = useState("");
  const [pw, setPw] = useState(""); const [showPw, setShowPw] = useState(false);
  const [chip, setChip] = useState(null);
  const [busy, setBusy] = useState(false);

  async function call(body) {
    return fetch("/api/auth/forgot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json()).catch(() => ({ ok: false, reason: "Network problem — try again" }));
  }

  async function send(e) {
    e.preventDefault();
    setBusy(true); setChip(null);
    const r = await call({ action: "send", who });
    setBusy(false);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    setName(r.name); setShownCode(r.manualCode || null);
    setCode(""); setPw("");
    setChip(r.manualCode ? null : { tone: "ok", text: r.note });
    setStep("reset");
  }

  async function reset(e) {
    e.preventDefault();
    setBusy(true); setChip(null);
    const r = await call({ action: "reset", who, code, password: pw });
    setBusy(false);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    setStep("done");
  }

  if (step === "done") return (
    <div style={S.page}>
      <div style={{ width: "min(420px,100%)" }}>
        <div style={S.brand}>SLF <span style={{ color: "#e0a63a" }}>GoldDesk</span></div>
        <div style={S.card}>
          <div style={S.chip("ok")}>Password changed. Every old session on every device is signed out.</div>
          <a href="/login" style={{ textDecoration: "none" }}>
            <button type="button" style={{ ...S.btn, marginTop: 14 }}>Go to sign in</button></a>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.page}>
      <div style={{ width: "min(420px,100%)" }}>
        <div style={S.brand}>SLF <span style={{ color: "#e0a63a" }}>GoldDesk</span></div>
        <div style={S.sub}>Forgot password</div>

        {step === "who" && (
          <form onSubmit={send} style={S.card}>
            <label style={S.label} htmlFor="w">Username · employee code · mobile</label>
            <input id="w" style={{ ...S.input, ...S.mono }} value={who} autoFocus
              autoCapitalize="none" autoCorrect="off" disabled={busy}
              onChange={e => setWho(e.target.value)} placeholder="e.g. saritap / EMP0004 / 98220 12345" />
            {chip && <div style={{ ...S.chip(chip.tone), marginTop: 14 }}>{chip.text}</div>}
            <button style={{ ...S.btn, marginTop: 16 }} disabled={busy || !who.trim()}>
              {busy ? "Checking…" : "Get code"}</button>
            <div style={S.foot}><a href="/login" style={{ color: "#5f8f7b" }}>← Back to sign in</a></div>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={reset} style={S.card}>
            <div style={S.chip("ok")}>Resetting the password for <b>{name}</b></div>

            {shownCode && (
              <div style={S.otpBox}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
                              color: "#a06407", textTransform: "uppercase" }}>
                  Testing mode — SMS gateway not connected</div>
                <div style={{ ...S.mono, fontSize: 30, fontWeight: 900, color: "#7a4c05",
                              letterSpacing: ".25em", marginTop: 4 }}>{shownCode}</div>
                <div style={{ fontSize: 11.5, color: "#a06407", marginTop: 2 }}>
                  This code will arrive by SMS once the gateway is live. Valid 5 minutes.</div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <label style={S.label} htmlFor="c">Enter the 6-digit code</label>
              <input id="c" style={{ ...S.input, ...S.mono, textAlign: "center",
                       fontSize: 20, letterSpacing: ".3em" }} value={code} inputMode="numeric"
                maxLength={6} disabled={busy} autoFocus
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="••••••" />
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={S.label} htmlFor="np">New password</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="np" style={S.input} type={showPw ? "text" : "password"} value={pw}
                  disabled={busy} onChange={e => setPw(e.target.value)} />
                <button type="button" style={S.ghost} onClick={() => setShowPw(s => !s)}>
                  {showPw ? "Hide" : "Show"}</button>
              </div>
              <div style={{ color: "#5f8f7b", fontSize: 11.5, marginTop: 5 }}>
                At least 10 characters, one letter, one number, not your username.</div>
            </div>

            {chip && <div style={{ ...S.chip(chip.tone), marginTop: 14 }}>{chip.text}</div>}
            <button style={{ ...S.btn, marginTop: 16 }} disabled={busy || code.length !== 6 || !pw}>
              {busy ? "Saving…" : "Set new password"}</button>
            <div style={S.foot}>
              <button type="button" onClick={send} disabled={busy}
                style={{ background: "none", border: 0, color: "#5f8f7b", cursor: "pointer",
                         fontSize: 11.5, fontWeight: 700 }}>Code expired? Get a fresh one</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
