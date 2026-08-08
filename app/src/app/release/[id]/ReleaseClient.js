"use client";
import { useEffect, useState } from "react";
import PhotoInput from "@/components/PhotoInput.js";

export default function ReleaseClient({ loanId }) {
  const [row, setRow] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [copied, setCopied] = useState(false);

  const [idOk, setIdOk] = useState(false);
  const [sealOk, setSealOk] = useState(false);
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    fetch("/api/release").then(r => r.json()).then(r => {
      if (!r.ok) return setErr(r.reason);
      const x = r.rows.find(v => v.loanId === loanId);
      if (!x) return setErr("This loan is not waiting for release");
      setRow(x);
    }).catch(() => setErr("Could not load the loan"));
  }, [loanId]);

  if (err && !row) return <div className="card"><span className="chip bad">{err}</span>
    <div style={{ marginTop: 12 }}><a href="/release" className="btn ghost"
      style={{ textDecoration: "none" }}>← Back to the list</a></div></div>;
  if (!row) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  const grams = (row.netMg / 1000).toFixed(3);

  if (done) return (
    <div style={{ maxWidth: 620, margin: "0 auto", textAlign: "center", padding: "20px 0" }}>
      <div style={{ fontSize: 52, lineHeight: 1, color: "#1e7a4f" }}>✓</div>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: "10px 0 2px" }}>Gold RELEASED — file closed</h1>
      <p style={{ color: "var(--mut)", fontSize: 13, margin: "0 0 6px" }}>
        सोने परत करण्यात आले — फाईल पूर्ण बंद</p>
      <p style={{ color: "var(--mut)", fontSize: 14, margin: "0 0 4px" }}>
        {done.customerName} · {done.grams} g · packet {done.packetNo} ·
        {" "}day {row.slaDay} of 7 {row.slaDay <= 7 &&
          <span className="chip ok" style={{ marginLeft: 4 }}>within SLA</span>}</p>
      <p className="mono" style={{ fontSize: 13.5, margin: "0 0 4px" }}>NOC {done.nocNo}</p>
      <p style={{ color: "var(--mut)", fontSize: 13, margin: "0 0 16px" }}>
        Vault register updated · custody chain complete</p>

      <div className="card" style={{ textAlign: "left" }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
          letterSpacing: ".07em", color: "var(--mut)", marginBottom: 8 }}>
          WhatsApp → {done.mobile} (Marathi) — copy and send from the branch phone</div>
        <div style={{ fontSize: 14, lineHeight: 1.6, background: "#e2f2e9",
          border: "1px solid #9bcfb3", borderRadius: 12, padding: "10px 13px" }}>{done.whatsapp}</div>
        <button className="btn ghost" style={{ marginTop: 10 }}
          onClick={() => { navigator.clipboard?.writeText(done.whatsapp).then(() => setCopied(true)); }}>
          {copied ? "✓ Copied" : "Copy message"}</button>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center" }}>
        <a href="/release" className="btn" style={{ textDecoration: "none" }}>← Back to the list</a>
      </div>
    </div>
  );

  async function doRelease() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/release", { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loanId, identityOk: idOk, sealOk,
        handoverPhotoId: photo?.fileId, collectedBy: "borrower" }) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not send" }));
    setBusy(false);
    if (!r.ok) setErr(r.reason); else setDone(r);
  }

  const ready = idOk && sealOk && !!photo;

  const tick = (on, set, text) => (
    <button type="button" onClick={() => set(!on)}
      style={{ display: "flex", gap: 12, alignItems: "flex-start", width: "100%",
        textAlign: "left", cursor: "pointer",
        background: on ? "#e2f2e9" : "#fff", border: "1px solid " + (on ? "#9bcfb3" : "#cfc9ba"),
        borderRadius: 12, padding: "13px 15px", marginBottom: 10 }}>
      <span style={{ width: 22, height: 22, border: "2px solid " + (on ? "#a06407" : "#cfc9ba"),
        borderRadius: 6, display: "grid", placeItems: "center", fontWeight: 900,
        color: "#a06407", flex: "0 0 auto" }}>{on ? "✓" : ""}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: on ? "#1e7a4f" : "inherit" }}>{text}</span>
    </button>
  );

  return (
    <div style={{ maxWidth: 680 }}>
      <a href="/release" style={{ color: "var(--mut)", fontSize: 13, fontWeight: 700,
        textDecoration: "none" }}>← release list</a>
      <h1 style={{ fontSize: 24, fontWeight: 900, margin: "10px 0 6px" }}>
        Gold release — {row.customerName}</h1>
      <p className="mono" style={{ color: "var(--mut)", fontSize: 13, margin: "0 0 18px" }}>
        {row.loanNo} · packet {row.packetNo} · {grams} g · day {row.slaDay} of 7 working days</p>

      <div className="card">
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
          textTransform: "uppercase", color: "var(--mut)", marginBottom: 12 }}>
          At the counter, before the borrower</div>
        {tick(idOk, setIdOk,
          "Borrower identity re-verified — ID shown, face matched with the loan photo")}
        {tick(sealOk, setSealOk,
          "Packet scanned, seal shown INTACT, opened in front of the borrower")}
        <div style={{ marginTop: 4 }}>
          <PhotoInput kind="seal" label="📷 Capture acknowledgement + handover photo"
            value={photo} onChange={setPhoto}
            hint="The borrower holding the opened packet, with the signed acknowledgement visible." />
        </div>
      </div>

      {err && <div style={{ marginTop: 12 }}><span className="chip bad">{err}</span></div>}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button className="btn" disabled={!ready || busy}
          style={{ opacity: ready && !busy ? 1 : .45, cursor: ready && !busy ? "pointer" : "not-allowed" }}
          onClick={doRelease}>
          {busy ? "Releasing…" : `Release ${grams} g to borrower → close file`}
        </button>
      </div>
    </div>
  );
}
