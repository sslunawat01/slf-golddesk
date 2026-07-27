"use client";
import { useState } from "react";
const inr = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
const inr0 = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");

export default function RateClient({ mayPublish, inForce, label, purities, history, warnPct }) {
  const [market, setMarket] = useState(inForce ? String(Math.round(inForce.basePaise / 100)) : "");
  const [funding, setFunding] = useState(inForce ? String(Math.round(inForce.fundingPaise / 100)) : "");
  const [chip, setChip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const m = Number(market || 0), f = Number(funding || 0);
  const gap = m && f ? m - f : 0;
  const gapPct = m ? (gap / m) * 100 : 0;
  const pairBad = m && f && f > m;

  async function publish(confirmed = false) {
    setBusy(true); setChip(null);
    const r = await fetch("/api/rate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketRupees: m, fundingRupees: f, confirmed }),
    }).then(async res => (await res.json().catch(() => null)) ?? { ok: false, reason: `Server error ${res.status}` })
      .catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (r.needsConfirm) { setConfirm({ message: r.reason, currentPaise: r.currentPaise }); return; }
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    window.location.reload();
  }

  return (
    <div>
      <p style={{ color: "var(--mut)", fontSize: 14, marginTop: -8, marginBottom: 18, maxWidth: 720 }}>
        One market rate and one funding rate. The market rate is what the ornament is worth;
        the funding rate is what we lend against and must sit below it. Publishing is optional —
        the last rate stays in force until head office changes it.
      </p>

      {inForce ? (
        <div className="card" style={{ borderLeft: "6px solid " + (label.state === "today" ? "var(--ok)" : "var(--brass)") }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ font: "800 11px ui-sans-serif", letterSpacing: ".07em",
                textTransform: "uppercase", color: "var(--mut)" }}>Gold in force · {label.text}</div>
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginTop: 8, alignItems: "baseline" }}>
                <div><span className="mono" style={{ fontSize: 28, fontWeight: 900 }}>
                  {inr(inForce.basePaise)}</span>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>/g market</span></div>
                <div><span className="mono" style={{ fontSize: 28, fontWeight: 900, color: "#a8791f" }}>
                  {inr(inForce.fundingPaise)}</span>
                  <span style={{ fontSize: 13, color: "var(--mut)" }}>/g funding</span></div>
              </div>
              <div style={{ fontSize: 13, color: "var(--mut)", marginTop: 8 }}>set by {inForce.setter}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ borderLeft: "6px solid var(--bad)" }}>
          <span className="chip bad">no rate set — branches locked for new lending</span>
        </div>)}

      {mayPublish && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
            <div>
              <label className="f">Gold · market rate ₹/g *</label>
              <input className="i mono" inputMode="decimal" value={market} placeholder="12040"
                style={{ fontSize: 20, height: 52 }}
                onChange={e => setMarket(e.target.value.replace(/[^\d.]/g, ""))} />
              <div className="hint" style={{ marginTop: 6 }}>what the ornament is worth at today's market</div>
            </div>
            <div>
              <label className="f">Gold · funding rate ₹/g *</label>
              <input className="i mono" inputMode="decimal" value={funding} placeholder="11290"
                style={{ fontSize: 20, height: 52, color: "#a8791f",
                  borderColor: pairBad ? "var(--bad)" : undefined }}
                onChange={e => setFunding(e.target.value.replace(/[^\d.]/g, ""))} />
              <div className="hint" style={{ marginTop: 6 }}>what we lend against — must be below the market rate</div>
            </div>
          </div>

          {m > 0 && f > 0 && (
            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {pairBad
                ? <span className="chip bad">the funding rate cannot be above the market rate —
                    we would lend more than the gold is worth</span>
                : <span className="chip ok">margin ₹{Math.round(gap).toLocaleString("en-IN")}/g ·
                    {" "}{gapPct.toFixed(1)}% haircut before the scheme's funding % applies</span>}
            </div>)}

          <button className="btn green" style={{ marginTop: 16 }}
            disabled={busy || !m || !f || pairBad} onClick={() => publish(false)}>
            {busy ? "…" : inForce ? "Change rates" : "Set rates"}</button>
          <div className="hint" style={{ marginTop: 8 }}>
            A move of more than {warnPct}% from the rate in force asks you to confirm.
            A rate carries forward until it is changed.
          </div>
        </div>)}

      {chip && <div style={{ marginTop: 12 }}><span className={"chip " + chip.tone}>{chip.text}</span></div>}

      {m > 0 && f > 0 && !pairBad && (<>
        <h2 style={{ fontSize: 15, fontWeight: 800, margin: "24px 0 10px" }}>
          At each purity, before the scheme's funding %</h2>
        <div className="card" style={{ display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 18 }}>
          {purities.map(p => (
            <div key={p.karat}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{p.karat} · {p.pct}%</div>
              <div className="mono" style={{ fontSize: 13, color: "var(--mut)", marginTop: 4 }}>
                market {inr0(Math.round(m * 100 * p.pct / 100))}</div>
              <div className="mono" style={{ fontSize: 13, color: "#a8791f", fontWeight: 700 }}>
                funding {inr0(Math.round(f * 100 * p.pct / 100))}</div>
            </div>))}
        </div>
      </>)}

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: "24px 0 10px" }}>Rate changes</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead><tr style={{ textAlign: "left", color: "var(--mut)", fontSize: 11 }}>
            {["DATE","MARKET","FUNDING","HAIRCUT","MOVE","SET BY"].map(h =>
              <th key={h} style={{ padding: "6px 8px" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {history.length === 0 && <tr><td colSpan={6} style={{ padding: 12, color: "var(--mut)" }}>No rates yet.</td></tr>}
            {history.map(h => {
              const hc = h.base_paise ? ((h.base_paise - h.funding_paise) / h.base_paise) * 100 : 0;
              return (
                <tr key={h.rate_date} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: 8 }} className="mono">{h.rate_date}</td>
                  <td style={{ padding: 8 }} className="mono"><b>{inr(h.base_paise)}</b></td>
                  <td style={{ padding: 8, color: "#a8791f" }} className="mono"><b>{inr(h.funding_paise)}</b></td>
                  <td style={{ padding: 8 }} className="mono">{hc.toFixed(1)}%</td>
                  <td style={{ padding: 8 }} className="mono">
                    {h.jump_pct === null || h.jump_pct === 0 ? "—"
                      : <span style={{ color: h.jump_pct > 0 ? "var(--ok)" : "var(--bad)" }}>
                          {h.jump_pct > 0 ? "+" : ""}{h.jump_pct.toFixed(2)}%</span>}
                    {h.jump_confirmed && <span className="chip warn" style={{ marginLeft: 6 }}>confirmed</span>}
                  </td>
                  <td style={{ padding: 8 }}>{h.setter}</td>
                </tr>);})}
          </tbody>
        </table>
      </div>

      {confirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(12,35,27,.6)", display: "grid",
          placeItems: "center", zIndex: 40, padding: 16 }}>
          <div className="card" style={{ maxWidth: 460, borderTop: "6px solid var(--warn)" }}>
            <h2 style={{ fontSize: 19, fontWeight: 900 }}>⚠ That is a large change</h2>
            <p style={{ color: "var(--mut)", fontSize: 14, margin: "10px 0" }}>{confirm.message}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setConfirm(null)}>Go back and check</button>
              <button className="btn green" onClick={() => { setConfirm(null); publish(true); }}>
                Yes, this is correct</button>
            </div>
          </div>
        </div>)}
    </div>);
}
