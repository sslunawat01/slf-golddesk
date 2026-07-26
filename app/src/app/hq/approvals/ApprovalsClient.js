"use client";
import { useState } from "react";
const inr = (p) => "₹" + Math.round(Number(p) / 100).toLocaleString("en-IN");
const g = (mg) => (Number(mg) / 1000).toFixed(3);

export default function ApprovalsClient({ waiting, decided, meId }) {
  const [busy, setBusy] = useState(null);
  const [chip, setChip] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");

  async function decide(id, decision, why) {
    setBusy(id); setChip(null);
    const r = await fetch(`/api/approvals/${id}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason: why }),
    }).then(r => r.json()).catch(() => ({ ok: false, reason: "Network problem" }));
    setBusy(null);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    window.location.reload();
  }

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      {chip && <span className={"chip " + chip.tone}>{chip.text}</span>}

      {waiting.length === 0 && (
        <div className="card" style={{ color: "var(--mut)" }}>Nothing waiting. Branches are within their limits.</div>)}

      {waiting.map(a => {
        const mine = Number(a.recommended_by) === Number(meId);
        const waited = Math.round((Date.now() - new Date(a.submitted_at)) / 60000);
        return (
          <div key={a.id} className="card" style={{ borderLeft: "6px solid var(--brass)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 17 }}>{a.customer}</div>
                <div className="mono" style={{ color: "var(--mut)", fontSize: 13 }}>
                  {a.cust_no} · {a.mobile} · {a.app_no}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--mut)" }}>REQUESTED</div>
                <div className="mono" style={{ fontSize: 22, fontWeight: 900 }}>{inr(a.amount_paise)}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 10, marginTop: 14, fontSize: 13.5 }}>
              <Cell k="Branch" v={`${a.branch_code} · ${a.branch_name}`} />
              <Cell k="Scheme" v={`${a.scheme} · fund ${a.funding_pct}%`} />
              <Cell k="Gold" v={`${g(a.net_mg)} g · ${a.item_count} item(s)`} />
              <Cell k="Market value" v={inr(a.market_paise)} />
              <Cell k="Funding value" v={inr(a.funding_paise)} brass />
              <Cell k="Purpose" v={a.purpose} />
              <Cell k="Valuers" v={[a.valuer1, a.valuer2].filter(Boolean).join(" + ") || "—"} />
              <Cell k="Waiting" v={waited < 60 ? `${waited} min` : `${Math.floor(waited / 60)} h ${waited % 60} m`} />
            </div>

            <div style={{ marginTop: 12, fontSize: 13, color: "var(--mut)" }}>
              Recommended by <b>{a.recommender}</b>
              {a.amount_paise > a.funding_paise &&
                <span className="chip bad" style={{ marginLeft: 8 }}>above funding value</span>}
            </div>

            {rejecting === a.id ? (
              <div style={{ marginTop: 12 }}>
                <label className="f">Reason for rejection</label>
                <input className="i" autoFocus value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="at least 5 characters — the branch will see this" />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn ghost" onClick={() => { setRejecting(null); setReason(""); }}>Back</button>
                  <button className="btn" style={{ background: "var(--bad)", color: "#fff" }}
                    disabled={reason.trim().length < 5 || busy === a.id}
                    onClick={() => decide(a.id, "reject", reason)}>Confirm rejection</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                {mine
                  ? <span className="chip warn">you recommended this — another person must decide it</span>
                  : <>
                      <button className="btn ghost" disabled={busy === a.id}
                        onClick={() => setRejecting(a.id)}>Reject</button>
                      <button className="btn green" disabled={busy === a.id}
                        onClick={() => decide(a.id, "approve")}>
                        {busy === a.id ? "…" : `Approve ${inr(a.amount_paise)}`}</button>
                    </>}
              </div>
            )}
          </div>);
      })}

      {decided.length > 0 && (
        <div className="card">
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
            color: "var(--mut)", marginBottom: 10 }}>Decided today</div>
          {decided.map(d => (
            <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10,
              padding: "8px 0", borderTop: "1px solid var(--line)", fontSize: 14, flexWrap: "wrap" }}>
              <span>{d.customer} · <span className="mono">{d.branch_code}</span></span>
              <span className="mono">{inr(d.amount_paise)}</span>
              <span className={"chip " + (d.status === "approved" ? "ok" : "bad")}>
                {d.status}{d.reject_reason ? ` — ${d.reject_reason}` : ""}</span>
              <span style={{ color: "var(--mut)" }}>{d.decider}</span>
            </div>))}
        </div>)}
    </div>
  );
}

const Cell = ({ k, v, brass }) => (
  <div>
    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em",
      textTransform: "uppercase", color: "var(--mut)" }}>{k}</div>
    <div className="mono" style={{ fontWeight: 700, color: brass ? "#a8791f" : "inherit" }}>{v}</div>
  </div>);
