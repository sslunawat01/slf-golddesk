"use client";
import { useState } from "react";
import PhotoInput from "@/components/PhotoInput.js";
import { METHODS } from "@/lib/overdue.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 10px",
  height: 40, fontSize: 13, background: "#fff", boxSizing: "border-box" };

/** №11 — Add charge · Add follow-up · Upload document, on every active loan card. */
export default function LoanExtrasClient({ loanId, outcomes, today, canCollect }) {
  const [mode, setMode] = useState(null);   // 'fu' | 'doc'
  const [fu, setFu] = useState({ method: "", outcome: "", ptpDate: "", nextFollowUp: "", narration: "" });
  const [doc, setDoc] = useState({ file: null, note: "" });
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(null);

  async function post(url, body) {
    setBusy(true); setChip(null);
    const r = await fetch(url, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(x => x.json()).catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return false; }
    window.location.reload();
    return true;
  }

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <a href={`/addcharge/${loanId}`} className="btn ghost"
          style={{ padding: "6px 11px", fontSize: 12, textDecoration: "none" }}>+ Charge</a>
        {canCollect && (
          <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
            onClick={() => { setMode(mode === "fu" ? null : "fu"); setChip(null); }}>
            + Follow-up</button>)}
        <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
          onClick={() => { setMode(mode === "doc" ? null : "doc"); setChip(null); }}>
          📎 Document</button>
        <a href={`/print/appraisal/${loanId}`} target="_blank" className="btn ghost"
          style={{ padding: "6px 11px", fontSize: 12, textDecoration: "none" }}>🖨 Appraisal</a>
        <a href={`/print/kfs/${loanId}`} target="_blank" className="btn ghost"
          style={{ padding: "6px 11px", fontSize: 12, textDecoration: "none" }}>🖨 Agreement/KFS</a>
      </div>

      {mode === "fu" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end",
          marginTop: 10, background: "#faf9f4", border: "1px solid #f0ede4",
          borderRadius: 10, padding: 10 }}>
          <div style={{ flex: "0 0 140px" }}><span style={F}>Method</span>
            <select style={I} value={fu.method}
              onChange={e => setFu({ ...fu, method: e.target.value })}>
              <option value="">—</option>
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select></div>
          <div style={{ flex: "0 0 150px" }}><span style={F}>Outcome</span>
            <select style={I} value={fu.outcome}
              onChange={e => setFu({ ...fu, outcome: e.target.value })}>
              <option value="">—</option>
              {outcomes.map(o => <option key={o} value={o}>{o}</option>)}
            </select></div>
          <div style={{ flex: "0 0 140px" }}><span style={F}>Next follow-up</span>
            <input type="date" min={today} style={I} value={fu.nextFollowUp}
              onChange={e => setFu({ ...fu, nextFollowUp: e.target.value })} /></div>
          <div style={{ flex: 1, minWidth: 150 }}><span style={F}>Narration</span>
            <input style={I} value={fu.narration}
              onChange={e => setFu({ ...fu, narration: e.target.value })} /></div>
          <button className="btn" disabled={busy || !fu.method || !fu.outcome}
            style={{ height: 40 }}
            onClick={() => post("/api/overdue", { loanId, ...fu })}>
            {busy ? "…" : "Save"}</button>
        </div>)}

      {mode === "doc" && (
        <div style={{ marginTop: 10, background: "#faf9f4", border: "1px solid #f0ede4",
          borderRadius: 10, padding: 10 }}>
          <PhotoInput kind="kyc_scan" label="📎 Document photo" value={doc.file}
            onChange={(f) => setDoc({ ...doc, file: f })} />
          <input style={{ ...I, marginTop: 8 }} value={doc.note}
            placeholder="What is this document? (required)"
            onChange={e => setDoc({ ...doc, note: e.target.value })} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" disabled={busy || !doc.file || doc.note.trim().length < 3}
              onClick={() => post(`/api/loans/${loanId}/documents`,
                { fileId: doc.file.fileId, note: doc.note })}>
              {busy ? "…" : "Attach to loan"}</button>
          </div>
        </div>)}

      {chip && <div style={{ marginTop: 8 }}>
        <span className={"chip " + chip.tone}>{chip.text}</span></div>}
    </div>
  );
}
