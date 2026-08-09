"use client";
import { useEffect, useState } from "react";
import { denomTotalPaise } from "@/lib/daycycle.js";

const inr = (p) => "₹" + Math.round(Number(p || 0) / 100).toLocaleString("en-IN");
const dmy = (d) => d ? String(d).split("-").reverse().join("-") : "—";

const CHECKS = [
  ["rate", "Today's rate pair is in force", "carried forward or freshly published"],
  ["seal", "Seal and tag stock checked", "enough numbered seals for the day"],
  ["queues", "Pending queues reviewed", "vault-in due · releases due · HO approvals"],
  ["report", "Yesterday's day-end report seen", "variances and reasons read"],
];

export default function DayCycleClient() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState(null); // decided after load

  const [checks, setChecks] = useState({});
  const [dbCount, setDbCount] = useState("");
  const [dbReason, setDbReason] = useState("");

  const [denoms, setDenoms] = useState({});
  const [deReason, setDeReason] = useState("");
  const [closed, setClosed] = useState(null);

  const load = () => fetch("/api/daycycle").then(r => r.json())
    .then(r => {
      if (!r.ok) return setErr(r.reason);
      setData(r);
      if (tab === null) setTab(r.beginSigned ? "end" : "begin");
    }).catch(() => setErr("Could not load the day cycle"));
  useEffect(() => { load(); }, []);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  if (closed) return (
    <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "center", padding: "24px 0" }}>
      <div style={{ fontSize: 52, lineHeight: 1, color: "#1e7a4f" }}>✓</div>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: "10px 0 6px" }}>Day closed</h1>
      <p style={{ color: "var(--mut)", fontSize: 14 }}>
        Expected {inr(closed.expectedPaise)} · counted {inr(closed.countedPaise)} ·
        variance <b className="mono">{inr(closed.variancePaise)}</b></p>
      <p style={{ color: "var(--mut)", fontSize: 13 }}>
        Tomorrow's day-begin carries {inr(closed.countedPaise)} forward.</p>
      <a href="/home" className="btn" style={{ textDecoration: "none" }}>Back to home</a>
    </div>
  );

  async function sign(body) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/daycycle", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not send" }));
    setBusy(false);
    if (!r.ok) setErr(r.reason);
    else if (body.action === "end") setClosed(r);
    else { setTab("end"); load(); }
  }

  const dbCountP = dbCount === "" ? null : Math.round(Number(dbCount) * 100);
  const dbDiff = (dbCountP ?? 0) - data.carry.paise;
  const dbAllTicked = CHECKS.every(([k]) => checks[k]);
  const dbReady = !data.beginSigned && dbAllTicked && dbCountP != null &&
    (dbDiff === 0 || dbReason.trim().length >= 5);

  const deCountP = denomTotalPaise(denoms);
  const deVar = deCountP - data.expectedPaise;
  const deReady = data.beginSigned && !data.endSigned &&
    (deVar === 0 || deReason.trim().length >= 5);

  const td = { padding: "9px 12px", borderBottom: "1px solid #efece3", fontSize: 13.5 };
  const pill = (key, label) => (
    <button key={key} onClick={() => setTab(key)}
      style={{ border: "1px solid " + (tab === key ? "var(--vault)" : "#cfc9ba"),
        background: tab === key ? "var(--vault)" : "#fff",
        color: tab === key ? "#fff" : "var(--mut)", borderRadius: 99,
        padding: "7px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{label}</button>
  );

  return (
    <>
      <p style={{ color: "var(--mut)", fontSize: 13.5, margin: "0 0 14px", maxWidth: 620 }}>
        A record of every day's cash, signed with your login. Day-begin does not lock the
        counter; variances sign off with a written reason.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {pill("begin", data.beginSigned ? "Day-begin ✓" : "Day-begin")}
        {pill("end", data.endSigned ? "Day-end ✓" : "Day-end")}
        {pill("hist", "Previous days")}
      </div>

      {/* ————————— day-begin ————————— */}
      {tab === "begin" && (data.beginSigned ? (
        <div className="card">
          <span className="chip ok">Day-begin signed</span>
          <div style={{ marginTop: 10, fontSize: 14, color: "var(--mut)" }}>
            Opening counted <b className="mono">{inr(data.begin.countedPaise)}</b>
            {data.begin.diffReason && <> · reason: {data.begin.diffReason}</>}
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 640 }}>
          <div className="card" style={{ marginBottom: 14, display: "flex",
            justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                color: "var(--mut)" }}>Opening cash carried from {data.carry.fromDate
                  ? dmy(data.carry.fromDate) : "— first day at this branch"}</div>
              <b className="mono" style={{ fontSize: 22 }}>{inr(data.carry.paise)}</b>
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
              letterSpacing: ".07em", color: "var(--mut)", marginBottom: 10 }}>
              Opening checks — all four</div>
            {CHECKS.map(([k, label, detail]) => (
              <button key={k} type="button" onClick={() => setChecks({ ...checks, [k]: !checks[k] })}
                style={{ display: "flex", gap: 10, width: "100%", textAlign: "left",
                  alignItems: "flex-start", cursor: "pointer", marginBottom: 8,
                  background: checks[k] ? "#e2f2e9" : "#fff",
                  border: "1px solid " + (checks[k] ? "#9bcfb3" : "#cfc9ba"),
                  borderRadius: 10, padding: "11px 13px" }}>
                <span style={{ width: 20, height: 20, border: "2px solid " +
                  (checks[k] ? "#1e7a4f" : "#cfc9ba"), borderRadius: 5, display: "grid",
                  placeItems: "center", fontWeight: 900, color: "#1e7a4f",
                  flex: "0 0 auto" }}>{checks[k] ? "✓" : ""}</span>
                <span><span style={{ fontWeight: 700, fontSize: 13.5 }}>{label}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--mut)" }}>{detail}</span></span>
              </button>
            ))}

            <label style={{ display: "block", fontSize: 10, fontWeight: 800,
              letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mut)",
              margin: "12px 0 4px" }}>Counted opening cash ₹</label>
            <input value={dbCount} inputMode="numeric"
              onChange={e => setDbCount(e.target.value.replace(/\D/g, "").slice(0, 8))}
              style={{ width: 200, border: "1px solid #cfc9ba", borderRadius: 10,
                padding: "10px 12px", fontSize: 18, fontWeight: 800,
                fontFamily: "ui-monospace,monospace" }} />
            {dbCountP != null && (
              <div style={{ marginTop: 8, fontSize: 13.5 }}>
                Difference vs carried forward:{" "}
                <b className="mono">{inr(dbDiff)}</b>{" "}
                {dbDiff === 0
                  ? <span className="chip ok">matches</span>
                  : <span className="chip warn">reason required</span>}
              </div>
            )}
            {dbCountP != null && dbDiff !== 0 && (
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 800,
                  letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mut)",
                  marginBottom: 4 }}>Reason for the difference · mandatory</label>
                <input value={dbReason} onChange={e => setDbReason(e.target.value)}
                  placeholder="e.g. ₹200 excess held in suspense from 20-07"
                  style={{ width: "100%", border: "1px solid #cfc9ba", borderRadius: 10,
                    padding: "10px 12px", fontSize: 14 }} />
              </div>
            )}
            <p className="hint" style={{ marginTop: 10 }}>
              Signed with your login and stamped with the time.</p>
          </div>

          {err && <div style={{ marginTop: 10 }}><span className="chip bad">{err}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" disabled={!dbReady || busy || !data.canAct}
              style={{ opacity: dbReady && !busy && data.canAct ? 1 : .4 }}
              onClick={() => sign({ action: "begin", checks, countedPaise: dbCountP,
                reason: dbReason })}>
              {busy ? "Signing…" : "Sign day-begin →"}</button>
          </div>
        </div>
      ))}

      {/* ————————— day-end ————————— */}
      {tab === "end" && (data.endSigned ? (
        <div className="card">
          <span className="chip ok">Day-end signed</span>
          <div style={{ marginTop: 10, fontSize: 14, color: "var(--mut)" }}>
            Counted <b className="mono">{inr(data.end.countedPaise)}</b> ·
            variance <b className="mono">{inr(data.end.variancePaise)}</b>
            {data.end.reason && <> · {data.end.reason}</>}
          </div>
        </div>
      ) : !data.beginSigned ? (
        <div className="card"><span className="chip warn">Sign day-begin first — the day has no recorded opening</span></div>
      ) : (
        <div style={{ maxWidth: 640 }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
              {[["Opening (signed)", data.begin.countedPaise],
                ["+ Cash receipts", data.flows.cashReceiptsPaise],
                ["− Cash disbursed", data.flows.cashDisbursedPaise],
                ["= System expects", data.expectedPaise]].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase",
                    color: "var(--mut)" }}>{k}</div>
                  <b className="mono" style={{ fontSize: 17 }}>{inr(v)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "#f0eee6" }}>
                {["Note", "Count", "Value"].map(h =>
                  <th key={h} style={{ ...td, textAlign: h === "Note" ? "left" : "right",
                    fontSize: 11, textTransform: "uppercase" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {data.notes.map(n => (
                  <tr key={n}>
                    <td style={{ ...td, fontWeight: 800 }}>₹{n}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <input value={denoms[n] || ""} inputMode="numeric"
                        onChange={e => setDenoms({ ...denoms,
                          [n]: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                        style={{ width: 90, border: "1px solid #cfc9ba", borderRadius: 8,
                          padding: "7px 10px", fontSize: 15, fontWeight: 800,
                          textAlign: "right", fontFamily: "ui-monospace,monospace" }} /></td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "ui-monospace,monospace" }}>
                      {inr((Number(denoms[n]) || 0) * n * 100)}</td>
                  </tr>
                ))}
                <tr style={{ background: "#f0eee6" }}>
                  <td style={{ ...td, fontWeight: 900 }}>Counted total</td>
                  <td style={td}></td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 900,
                    fontFamily: "ui-monospace,monospace" }}>{inr(deCountP)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ fontSize: 14 }}>
              Variance vs system: <b className="mono">{inr(deVar)}</b>{" "}
              {deVar === 0
                ? <span className="chip ok">matches</span>
                : <span className="chip warn">reason required — the day still closes</span>}
            </div>
            {deVar !== 0 && (
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "block", fontSize: 10, fontWeight: 800,
                  letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mut)",
                  marginBottom: 4 }}>Reason for variance · mandatory</label>
                <input value={deReason} onChange={e => setDeReason(e.target.value)}
                  placeholder="e.g. ₹500 short — excess change given, recovering tomorrow"
                  style={{ width: "100%", border: "1px solid #cfc9ba", borderRadius: 10,
                    padding: "10px 12px", fontSize: 14 }} />
              </div>
            )}
            <p className="hint" style={{ marginTop: 10 }}>
              Also review at sign-off: pending sanctions · release queue · vault spot-count.</p>
          </div>

          {err && <div style={{ marginTop: 10 }}><span className="chip bad">{err}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" disabled={!deReady || busy || !data.canAct}
              style={{ opacity: deReady && !busy && data.canAct ? 1 : .4 }}
              onClick={() => sign({ action: "end", denoms, reason: deReason })}>
              {busy ? "Signing…" : `Sign day-end · counted ${inr(deCountP)} →`}</button>
          </div>
        </div>
      ))}

      {/* ————————— history ————————— */}
      {tab === "hist" && (
        <div className="card" style={{ padding: 0, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
            <thead><tr style={{ background: "#f0eee6" }}>
              {["Date", "Expected", "Counted", "Variance", "Reason", "Signed"].map(h =>
                <th key={h} style={{ ...td, textAlign: "left", fontSize: 11,
                  textTransform: "uppercase" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data.history.map(h => (
                <tr key={h.business_date}>
                  <td style={td}>{dmy(h.business_date)}</td>
                  <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>{inr(h.end_expected_paise)}</td>
                  <td style={{ ...td, fontFamily: "ui-monospace,monospace" }}>{inr(h.end_counted_paise)}</td>
                  <td style={td}>{Number(h.end_variance_paise) === 0
                    ? <span className="chip ok">0</span>
                    : <span className="chip warn">{inr(h.end_variance_paise)}</span>}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{h.end_reason || h.begin_diff_reason || "—"}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{h.signed_name}</td>
                </tr>
              ))}
              {data.history.length === 0 && (
                <tr><td colSpan={6} style={{ ...td, color: "var(--mut)", textAlign: "center" }}>
                  No signed days yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
