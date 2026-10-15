"use client";
import { useState } from "react";
import TopNotice from "@/app/ui/TopNotice.js";

const rules = (p, u) => ([
  ["at least 10 characters", (p || "").length >= 10],
  ["one number", /\d/.test(p || "")],
  ["one letter", /[a-zA-Z]/.test(p || "")],
  ["not the same as your username", !!p && p.toLowerCase() !== (u || "").toLowerCase()],
]);

export default function SetPwClient({ forced = true, username = "", fullName = "" }) {
  const [cur, setCur] = useState("");
  const [p, setP] = useState(""); const [c, setC] = useState("");
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const list = rules(p, username);
  const ok = list.every(r => r[1]) && p === c && p.length > 0 && (forced || cur.length > 0);

  async function save(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch("/api/auth/password", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: p, current: forced ? undefined : cur }),
    }).then(r => r.json()).catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    window.location.href = "/login?changed=1";
  }

  return (
    <div className="signin"><div className="box">
      <div className="brand">SLF <b>GoldDesk</b></div>
      <div className="sub">{forced ? "Set a new password" : "Change my password"}</div>
      <form onSubmit={save} className="card stack" style={{ marginTop: 22 }} data-setpw={forced ? "forced" : "voluntary"}>
        <div style={{ fontSize: 12.5, color: "#7d786c" }}>
          {forced ? <>You signed in with a temporary password — choose your own to continue.</>
            : <>Signed in as <b>{fullName}</b> <span className="mono">({username})</span></>}</div>
        {!forced && (
          <div><label className="f">Current password</label>
            <input className="i" type="password" autoFocus autoComplete="current-password" value={cur}
              onChange={e => setCur(e.target.value)} data-cur /></div>)}
        <div><label className="f">New password</label>
          <input className="i" type="password" autoFocus={forced} autoComplete="new-password" value={p} onChange={e => setP(e.target.value)} data-new /></div>
        <div><label className="f">Confirm new password</label>
          <input className="i" type="password" autoComplete="new-password" value={c} onChange={e => setC(e.target.value)} data-confirm /></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {list.map(([label, pass]) => (
            <span key={label} className={"chip " + (pass ? "ok" : "mut")}>{pass ? "✓" : "•"} {label}</span>
          ))}
          {c.length > 0 && <span className={"chip " + (p === c ? "ok" : "bad")}>
            {p === c ? "✓ passwords match" : "passwords do not match"}</span>}
        </div>
        {err && <div><span className="chip bad">{err}</span></div>}
        <TopNotice notice={err} onClose={() => setErr(null)} />
        <button className="btn green" style={{ width: "100%" }} disabled={!ok || busy} data-save>
          {busy ? "Saving…" : forced ? "Set password and continue" : "Change password"}</button>
        <div style={{ fontSize: 12, color: "#7d786c", textAlign: "center" }}>
          You will sign in again with the new password{forced ? "" : " — every open session of yours ends"}.</div>
        {!forced && <a href="/home" style={{ fontSize: 12.5, textAlign: "center", color: "#7d786c" }}>Cancel — back to Home</a>}
      </form>
    </div></div>
  );
}
