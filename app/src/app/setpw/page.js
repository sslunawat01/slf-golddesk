"use client";
import { useState } from "react";

const rules = (p, u) => ([
  ["at least 10 characters", (p || "").length >= 10],
  ["one number", /\d/.test(p || "")],
  ["one letter", /[a-zA-Z]/.test(p || "")],
  ["not the same as your username", !!p && p.toLowerCase() !== (u || "").toLowerCase()],
]);

export default function SetPw() {
  const [p, setP] = useState(""); const [c, setC] = useState("");
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const list = rules(p, "");
  const ok = list.every(r => r[1]) && p === c && p.length > 0;

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch("/api/auth/password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: p }),
    }).then(r => r.json());
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    window.location.href = "/login";
  }

  return (
    <div className="signin"><div className="box">
      <div className="brand">SLF <b>GoldDesk</b></div>
      <div className="sub">Set a new password</div>
      <form onSubmit={save} className="card stack" style={{ marginTop: 22 }}>
        <div><label className="f">New password</label>
          <input className="i" type="password" autoFocus value={p} onChange={e => setP(e.target.value)} /></div>
        <div><label className="f">Confirm password</label>
          <input className="i" type="password" value={c} onChange={e => setC(e.target.value)} /></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {list.map(([label, pass]) => (
            <span key={label} className={"chip " + (pass ? "ok" : "mut")}>{pass ? "✓" : "•"} {label}</span>
          ))}
          {c.length > 0 && <span className={"chip " + (p === c ? "ok" : "bad")}>
            {p === c ? "✓ passwords match" : "passwords do not match"}</span>}
        </div>
        {err && <div><span className="chip bad">{err}</span></div>}
        <button className="btn green" style={{ width: "100%" }} disabled={!ok || busy}>
          {busy ? "Saving…" : "Set password and continue"}</button>
        <div style={{ fontSize: 12, color: "#7d786c", textAlign: "center" }}>
          You will sign in again with the new password.</div>
      </form>
    </div></div>
  );
}
