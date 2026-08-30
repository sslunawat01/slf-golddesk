"use client";
import { useEffect, useState } from "react";
import TopNotice from "@/app/ui/TopNotice.js";

const inr = (p) => "₹" + Math.round(Number(p || 0) / 100).toLocaleString("en-IN");

export default function AddChargeClient({ loanId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [qy, setQy] = useState("");
  const [picks, setPicks] = useState({});   // chargeTypeId -> entered rupees string
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch(`/api/loans/${loanId}/charges`).then(r => r.json())
      .then(r => r.ok ? setData(r) : setErr(r.reason))
      .catch(() => setErr("Could not load the charges master"));
  }, [loanId]);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  if (done) return (
    <div className="card">
      <span className="chip ok">{done.added.length} charge{done.added.length === 1 ? "" : "s"} added · {inr(done.totalPaise)}</span>
      <div style={{ marginTop: 10, fontSize: 14, color: "var(--mut)", lineHeight: 1.7 }}>
        {done.added.map(a => <div key={a.id}>{a.name} — <b className="mono">{inr(a.totalPaise)}</b></div>)}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Collected at the next repayment — charges are appropriated first.</p>
      <div style={{ marginTop: 14 }}>
        <a href={`/repay/${loanId}`} className="btn" style={{ textDecoration: "none", marginRight: 8 }}>
          Collect now →</a>
        <a href="/home" className="btn ghost" style={{ textDecoration: "none" }}>Home</a>
      </div>
    </div>
  );

  const pickedIds = Object.keys(picks);
  let total = 0, anyBad = false;
  for (const idStr of pickedIds) {
    const t = data.types.find(x => String(x.id) === idStr);
    const amtP = Math.round(Number(picks[idStr] || 0) * 100);
    total += amtP;
    if (t.manual ? amtP <= 0 : amtP < t.defaultTotalPaise) anyBad = true;
  }
  const ready = pickedIds.length > 0 && !anyBad && total > 0 &&
    note.trim().length >= 5 && data.loan.status === "active";

  const shown = data.types.filter(t => {
    if (picks[t.id] !== undefined) return true;
    const s = (t.name + " " + t.basis).toLowerCase();
    return !qy.trim() || s.includes(qy.toLowerCase().trim());
  });

  const toggle = (t) => {
    const np = { ...picks };
    if (np[t.id] !== undefined) delete np[t.id];
    else np[t.id] = t.manual ? "" : String(Math.round(t.defaultTotalPaise / 100));
    setPicks(np);
  };

  async function save() {
    setBusy(true); setErr(null);
    const body = { narration: note.trim(),
      picks: pickedIds.map(idStr => ({ chargeTypeId: Number(idStr),
        totalPaise: Math.round(Number(picks[idStr] || 0) * 100) })) };
    const r = await fetch(`/api/loans/${loanId}/charges`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) setErr(r.reason); else setDone(r);
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <a href={`/repay/${loanId}`} style={{ color: "var(--mut)", fontSize: 13, fontWeight: 700,
        textDecoration: "none" }}>← {data.loan.customerName}</a>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: "10px 0 6px" }}>
        Add charge — {data.loan.customerName}</h1>
      <p className="mono" style={{ color: "var(--mut)", fontSize: 13, margin: "0 0 18px" }}>
        {data.loan.loanNo} · {data.loan.schemeCode}</p>

      {data.loan.status !== "active" && (
        <div style={{ marginBottom: 14 }}>
          <span className="chip bad">This loan is {data.loan.status} — charges can only be added to a running loan</span>
        </div>
      )}

      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
          textTransform: "uppercase", color: "var(--mut)", marginBottom: 10 }}>
          Charge types — from the HQ charges master · tick all that apply</div>
        <input value={qy} onChange={e => setQy(e.target.value)}
          placeholder="Search charges — name or basis…"
          style={{ width: "100%", border: "1px solid #cfc9ba", borderRadius: 10,
            padding: "10px 12px", fontSize: 14, marginBottom: 6 }} />
        <div className="hint" style={{ marginBottom: 10 }}>
          {data.types.length} charge types in the master · {pickedIds.length} selected
          {pickedIds.length > 0 && ` · ${inr(total)}`}</div>

        <div style={{ display: "grid", gap: 8 }}>
          {shown.map(t => {
            const picked = picks[t.id] !== undefined;
            const amtP = picked ? Math.round(Number(picks[t.id] || 0) * 100) : 0;
            const bad = picked && (t.manual ? amtP <= 0 : amtP < t.defaultTotalPaise);
            return (
              <div key={t.id} style={{ border: "1px solid " + (picked ? "var(--vault)" : "#e2ddd1"),
                background: picked ? "#f4f7f4" : "#fff", borderRadius: 12, padding: "12px 14px" }}>
                <div onClick={() => toggle(t)} style={{ display: "flex",
                  justifyContent: "space-between", gap: 12, cursor: "pointer", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <span style={{ width: 20, height: 20, border: "2px solid " +
                      (picked ? "var(--vault)" : "#cfc9ba"),
                      background: picked ? "var(--vault)" : "#fff", color: "#fff",
                      borderRadius: 5, display: "grid", placeItems: "center", fontSize: 13,
                      fontWeight: 900, flex: "0 0 auto", marginTop: 1 }}>{picked ? "✓" : ""}</span>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14.5 }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 2 }}>{t.basis}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="mono" style={{ fontWeight: 800, fontSize: 14 }}>
                      {t.manual ? "at actuals" : inr(t.defaultTotalPaise)}</div>
                    {!t.manual && t.defaultGstPaise > 0 && (
                      <div style={{ fontSize: 11, color: "var(--mut)" }}>
                        {inr(t.defaultBasePaise)} + GST {inr(t.defaultGstPaise)}</div>)}
                  </div>
                </div>
                {picked && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #e2ddd1" }}>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 800,
                      letterSpacing: ".08em", textTransform: "uppercase", color: "var(--mut)",
                      marginBottom: 4 }}>Amount ₹ (incl. GST)</label>
                    <input value={picks[t.id]} inputMode="numeric"
                      onChange={e => setPicks({ ...picks,
                        [t.id]: e.target.value.replace(/\D/g, "").slice(0, 7) })}
                      style={{ width: 160, border: "1px solid " + (bad ? "var(--bad)" : "#cfc9ba"),
                        borderRadius: 10, padding: "9px 11px", fontSize: 15, fontWeight: 800,
                        fontFamily: "ui-monospace,monospace" }} />
                    <div className="hint">
                      {t.manual ? "as billed — enter the amount"
                        : `default ${inr(t.defaultTotalPaise)} · you may increase, never reduce`}</div>
                    {bad && <span className="chip bad" style={{ marginTop: 6 }}>
                      {t.manual ? "enter the billed amount"
                        : `below the master default ${inr(t.defaultTotalPaise)} — not allowed`}</span>}
                  </div>
                )}
              </div>
            );
          })}
          {shown.length === 0 && <div style={{ color: "var(--mut)", fontSize: 13.5 }}>
            No charge matches that search.</div>}
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 4 }}>
            Narration — appears on the customer's repayment screen</label>
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="e.g. Registered reminder notice sent 28-07"
            style={{ width: "100%", border: "1px solid #cfc9ba", borderRadius: 10,
              padding: "10px 12px", fontSize: 14 }} />
          <div className="hint">{note.trim().length}/5 characters minimum</div>
        </div>
      </div>

      {err && <div style={{ marginTop: 12 }}><span className="chip bad">{err}</span></div>}
      <TopNotice notice={err} onClose={() => setErr(null)} />

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button className="btn" disabled={!ready || busy || !data.canAct}
          style={{ opacity: ready && !busy && data.canAct ? 1 : .4 }}
          onClick={save}>
          {busy ? "Saving…" : pickedIds.length
            ? `Add ${pickedIds.length} charge${pickedIds.length === 1 ? "" : "s"} · ${inr(total)} →`
            : "Add charges →"}
        </button>
      </div>
    </div>
  );
}
