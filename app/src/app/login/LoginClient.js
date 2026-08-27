"use client";
import { useState, useEffect } from "react";

/* Ported 1:1 from the Claude Design auth screens, wired to the real backend.
   Dark vault chrome, brass accents, chips for every state — no popups. */

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
  ratePill: { display: "inline-block", padding: "5px 12px", borderRadius: 99, fontSize: 13,
              fontWeight: 800, background: "#123227", color: "#f6d78a",
              fontFamily: "ui-monospace,'SF Mono',Consolas,Menlo,monospace" },
  warnPill: { display: "inline-block", padding: "6px 13px", borderRadius: 99, fontSize: 12,
              fontWeight: 800, background: "#fdf1d8", color: "#a06407" },
  foot:  { color: "#43604f", fontSize: 11, marginTop: 16, textAlign: "center" },
};

export default function Login({ rate }) {
  const [screen, setScreen] = useState("signin");   // signin | branch | overlay
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [keep, setKeep] = useState(true);
  const [chip, setChip] = useState(null);           // {tone, text}
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState([]);
  const [empId, setEmpId] = useState(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("expired"))
      setChip({ tone: "warn", text: "Signed out after 30 minutes of inactivity." });
    else if (sp.get("out"))
      setChip({ tone: "ok", text: "Signed out successfully." });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setChip(null);
    const r = await fetch("/api/auth/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: u, password: p, keep }),
    }).then(r => r.json()).catch(() => ({ ok: false, reason: "Network problem — try again" }));

    if (!r.ok) { setBusy(false); setChip({ tone: r.window ? "warn" : "bad", text: r.reason }); return; }
    if (r.next === "branch") { setBusy(false); setBranches(r.branches); setEmpId(r.employeeId); setScreen("branch"); return; }
    setScreen("overlay");
    window.location.href = r.next === "password" ? "/setpw" : "/home";
  }

  async function pickBranch(id) {
    setBusy(true);
    const r = await fetch("/api/auth/branch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ employeeId: empId, branchId: id, keep }),
    }).then(r => r.json()).catch(() => ({ ok: false, reason: "Network problem — try again" }));
    if (!r.ok) { setBusy(false); setChip({ tone: "bad", text: r.reason }); return; }
    setScreen("overlay");
    window.location.href = r.next === "password" ? "/setpw" : "/home";
  }

  if (screen === "overlay") return (
    <div style={S.page}>
      <div style={S.brand}>SLF <span style={{ color: "#e0a63a" }}>GoldDesk</span></div>
      <div style={{ ...S.sub, marginTop: 14 }}>Checking your permissions…</div>
      <div style={{ width: 180, height: 3, background: "#1b4434", borderRadius: 99, marginTop: 16, overflow: "hidden" }}>
        <div style={{ width: "40%", height: "100%", background: "#e0a63a",
                      animation: "slide 1.1s ease-in-out infinite" }} />
      </div>
      <style>{`@keyframes slide{0%{margin-left:-40%}100%{margin-left:100%}}`}</style>
    </div>
  );

  if (screen === "branch") return (
    <div style={S.page}>
      <div style={{ width: "min(720px,100%)" }}>
        <div style={{ ...S.brand, fontSize: 15 }}>SLF <span style={{ color: "#e0a63a" }}>GoldDesk</span></div>
        <h1 style={{ color: "#fff", fontSize: 21, fontWeight: 900, margin: "22px 0 6px", textAlign: "center" }}>
          Where are you working today?</h1>
        <p style={{ color: "#7fae99", fontSize: 13.5, margin: "0 0 18px", textAlign: "center" }}>
          Signed in as <span style={{ ...S.mono, color: "#f6d78a" }}>{u}</span> — this account works at {branches.length} branches.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
          {branches.map(b => (
            <button key={b.id} type="button" disabled={busy} onClick={() => pickBranch(b.id)}
              style={{ textAlign: "left", border: "1px solid #1b4434", background: "#123227",
                       borderRadius: 16, padding: 15, cursor: "pointer", color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1b4434",
                              color: "#f6d78a", display: "grid", placeItems: "center",
                              fontWeight: 900, ...S.mono }}>{b.code}</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{b.name}</div>
                  <div style={{ color: b.dayBegun ? "#4cc38a" : "#a06407", fontSize: 11.5, fontWeight: 700 }}>
                    {b.dayBegun ? "day-begin signed ✓" : "day-begin pending"}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
        {chip && <div style={{ ...S.chip(chip.tone), marginTop: 14 }}>{chip.text}</div>}
        <p style={{ color: "#43604f", fontSize: 11.5, marginTop: 16, textAlign: "center" }}>
          Everything you do today is recorded against this branch.</p>
      </div>
    </div>
  );

  const disabled = busy || !u || !p;
  return (
    <div style={S.page}>
      <div style={{ width: "min(420px,100%)" }}>
        <div style={S.brand}>SLF <span style={{ color: "#e0a63a" }}>GoldDesk</span></div>
        <div style={S.sub}>S Lunawat Finance · Bhagur, Nashik</div>

        <form onSubmit={submit} style={S.card}>
          <div>
            <label style={S.label} htmlFor="u">Username</label>
            <input id="u" style={{ ...S.input, ...S.mono }} value={u} autoFocus
              autoCapitalize="none" autoCorrect="off" disabled={busy}
              onChange={e => setU(e.target.value)} placeholder="e.g. saritap" />
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={S.label} htmlFor="p">Password</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id="p" style={S.input} type={showPw ? "text" : "password"} value={p}
                disabled={busy} onChange={e => setP(e.target.value)} />
              <button type="button" style={S.ghost} onClick={() => setShowPw(s => !s)}>
                {showPw ? "Hide" : "Show"}</button>
            </div>
          </div>

          <button type="button" onClick={() => setKeep(k => !k)}
            style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14,
                     background: "transparent", border: 0, cursor: "pointer", padding: 0 }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, flex: "0 0 auto",
                           border: "1px solid " + (keep ? "#e0a63a" : "#2c5a46"),
                           background: keep ? "#e0a63a" : "transparent", color: "#0c231b",
                           display: "grid", placeItems: "center", fontSize: 12, fontWeight: 900 }}>
              {keep ? "✓" : ""}</span>
            <span style={{ color: "#cfe4da", fontSize: 12.5, fontWeight: 700 }}>
              Keep me signed in on this device</span>
          </button>

          {chip && <div style={{ ...S.chip(chip.tone), marginTop: 14 }}>{chip.text}</div>}

          <button type="submit" disabled={disabled}
            style={{ ...S.btn, marginTop: 16, opacity: disabled ? 0.4 : 1,
                     cursor: disabled ? "not-allowed" : "pointer" }}>
            {busy ? "Checking…" : "Sign in"}</button>

          <div style={{ textAlign: "center", marginTop: 12 }}>
            <a href="/forgot" style={{ color: "#5f8f7b", fontSize: 12, fontWeight: 700,
                 textDecoration: "none" }}>Forgot password?</a>
          </div>
        </form>

        <div style={{ textAlign: "center", marginTop: 18 }}>
          {rate
            ? <>
                <div style={S.ratePill}>{rate.display}</div>
                <div style={{ color: "#5f8f7b", fontSize: 10.5, fontWeight: 600, marginTop: 4 }}>
                  today's rate · published {rate.at}</div>
              </>
            : <div style={S.warnPill}>rate not published — lending locked</div>}
        </div>
        <div style={S.foot}>Access is logged. Contact HO to reset a password.</div>
      </div>
    </div>
  );
}
