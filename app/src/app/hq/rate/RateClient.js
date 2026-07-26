"use client";
import { useState } from "react";

const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
const inr2 = (p) => "₹" + (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function RateClient({ me, published, draft, purities, history }) {
  const [val, setVal] = useState("");
  const [chip, setChip] = useState(null);
  const [busy, setBusy] = useState(false);

  async function send(action, extra = {}) {
    setBusy(true); setChip(null);
    const r = await fetch("/api/rate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    }).then(r => r.json()).catch(() => ({ ok: false, reason: "Network problem" }));
    setBusy(false);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    window.location.reload();
  }

  const base = draft ? draft.base_paise : published ? published.base_paise : null;

  return (
    <div className="wrap" style={{ padding: "22px 16px 60px" }}>
      <a href="/home" style={{ color: "var(--mut)", fontSize: 13, textDecoration: "none" }}>← home</a>
      <h1 style={{ fontSize: 22, fontWeight: 900, marginTop: 8 }}>Daily gold rate</h1>
      <p style={{ color: "var(--mut)", fontSize: 14, margin: "6px 0 18px" }}>
        Published once a day by head office. Two people are required: one proposes, a different
        one publishes. Until it is published, branches cannot start new loans.
      </p>

      {published ? (
        <div className="card" style={{ borderLeft: "6px solid var(--ok)" }}>
          <span className="chip ok">published today</span>
          <div className="mono" style={{ fontSize: 30, fontWeight: 900, marginTop: 10 }}>
            {inr(published.base_paise)}<span style={{ fontSize: 15, color: "var(--mut)" }}> / gram · 24K</span></div>
          <div style={{ fontSize: 13, color: "var(--mut)", marginTop: 8 }}>
            proposed by {published.maker} · published by {published.checker}</div>
          <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 6 }}>
            A published rate can never be edited. A correction is a new rate row.</div>
        </div>
      ) : draft ? (
        <div className="card" style={{ borderLeft: "6px solid var(--warn)" }}>
          <span className="chip warn">awaiting checker</span>
          <div className="mono" style={{ fontSize: 30, fontWeight: 900, marginTop: 10 }}>
            {inr(draft.base_paise)}<span style={{ fontSize: 15, color: "var(--mut)" }}> / gram · 24K</span></div>
          <div style={{ fontSize: 13, color: "var(--mut)", marginTop: 8 }}>proposed by {draft.maker}</div>
          {me.mayCheck && Number(draft.maker_id) !== Number(me.id) ? (
            <button className="btn green" style={{ marginTop: 14 }} disabled={busy}
              onClick={() => send("publish")}>Confirm and publish to all branches</button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <span className="chip mut">
                {Number(draft.maker_id) === Number(me.id)
                  ? "you proposed this — a different person must publish it"
                  : "you do not have publishing rights"}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ borderLeft: "6px solid var(--bad)" }}>
          <span className="chip bad">not published — branches locked for new lending</span>
          {me.mayMake ? (
            <div style={{ marginTop: 14, maxWidth: 380 }}>
              <label className="f">24K rate — rupees per gram</label>
              <input className="i mono" inputMode="decimal" value={val} placeholder="12100"
                onChange={e => setVal(e.target.value.replace(/[^\d.]/g, ""))} />
              <button className="btn green" style={{ marginTop: 12, width: "100%" }}
                disabled={busy || !val} onClick={() => send("save", { rupeesPerGram: Number(val) })}>
                Propose this rate</button>
              <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 8 }}>
                A second person with publishing rights confirms it before branches see it.</div>
            </div>
          ) : <div style={{ marginTop: 12 }}><span className="chip mut">you may not propose the rate</span></div>}
        </div>
      )}

      {chip && <div style={{ marginTop: 12 }}><span className={"chip " + chip.tone}>{chip.text}</span></div>}

      {base && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 800, margin: "22px 0 10px" }}>
            What branches will lend at</h2>
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--mut)", fontSize: 11 }}>
                <th style={{ padding: "6px 8px" }}>PURITY</th>
                <th style={{ padding: "6px 8px" }}>% OF 24K</th>
                <th style={{ padding: "6px 8px" }}>VALUE / GRAM</th>
                <th style={{ padding: "6px 8px" }}>AT 70% FUNDING</th>
              </tr></thead>
              <tbody>
                {purities.map(p => {
                  const v = base * p.purity_pct / 100;
                  return (<tr key={p.karat} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px" }}><b>{p.karat}</b></td>
                    <td style={{ padding: "8px" }} className="mono">{p.purity_pct}%</td>
                    <td style={{ padding: "8px" }} className="mono">{inr2(v)}</td>
                    <td style={{ padding: "8px", color: "#a8791f", fontWeight: 800 }} className="mono">
                      {inr2(v * 0.7)}</td>
                  </tr>);
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: "22px 0 10px" }}>Rate history</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--mut)", fontSize: 11 }}>
            <th style={{ padding: "6px 8px" }}>DATE</th><th style={{ padding: "6px 8px" }}>24K RATE</th>
            <th style={{ padding: "6px 8px" }}>PROPOSED BY</th><th style={{ padding: "6px 8px" }}>PUBLISHED BY</th>
          </tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={4} style={{ padding: 12, color: "var(--mut)" }}>No rates yet.</td></tr>}
            {history.map(h => (
              <tr key={h.rate_date} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: "8px" }} className="mono">{h.rate_date}</td>
                <td style={{ padding: "8px" }} className="mono"><b>{inr(h.base_paise)}</b></td>
                <td style={{ padding: "8px" }}>{h.maker}</td>
                <td style={{ padding: "8px" }}>{h.checker}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 10 }}>
          Append-only. The database physically refuses to change a published rate.</div>
      </div>
    </div>
  );
}
