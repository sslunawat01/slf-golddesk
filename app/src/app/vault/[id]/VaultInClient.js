"use client";
import { useEffect, useState } from "react";
import PhotoInput from "@/components/PhotoInput.js";
import { mgToGrams, qrPayload, MISMATCH_REASONS, MIN_NARRATION } from "@/lib/vault.js";
import TopNotice from "@/app/ui/TopNotice.js";

const today = () => new Date().toLocaleDateString("en-GB").replace(/\//g, "-");

export default function VaultInClient({ packetId }) {
  const [p, setP] = useState(null);
  const [safes, setSafes] = useState([]);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const [seal, setSeal] = useState(false);
  const [items, setItems] = useState(false);
  const [weight, setWeight] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [safeId, setSafeId] = useState("");

  const [showMismatch, setShowMismatch] = useState(false);
  const [mReason, setMReason] = useState("");
  const [mNote, setMNote] = useState("");
  const [mPhoto, setMPhoto] = useState(null);

  useEffect(() => {
    fetch("/api/vault").then(r => r.json()).then(r => {
      if (!r.ok) return setErr(r.reason);
      const row = r.rows.find(x => x.id === packetId);
      if (!row) return setErr("That packet is not waiting for vault-in");
      setP(row); setSafes(r.safes);
      if (r.safes.length === 1) setSafeId(String(r.safes[0].id));
    }).catch(() => setErr("Could not load the packet"));
  }, [packetId]);

  async function send(body) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/vault", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packetId, ...body }) }).then(r => r.json());
      if (!r.ok) setErr(r.reason); else setDone(r.status);
    } catch { setErr("The action could not be sent"); }
    setBusy(false);
  }

  if (err && !p) return <div className="card"><span className="chip bad">{err}</span>
    <div style={{ marginTop: 12 }}><a href="/vault" className="btn ghost"
      style={{ textDecoration: "none" }}>← Back to the list</a></div></div>;
  if (!p) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  if (done) return (
    <div className="card">
      <span className={"chip " + (done === "in_safe" ? "ok" : "bad")}>
        {done === "in_safe" ? "Packet is in the safe" : "Packet frozen — Head Office notified"}</span>
      <div className="mono" style={{ marginTop: 10, fontSize: 13, color: "var(--mut)" }}>
        {p.packetNo} · {p.loanNo} · {p.customerName}</div>
      <div style={{ marginTop: 14 }}>
        <a href="/vault" className="btn" style={{ textDecoration: "none" }}>← Back to the list</a></div>
    </div>
  );

  const grams = mgToGrams(p.netMg);
  const chosenSafe = safes.find(s => String(s.id) === String(safeId));
  const ready = seal && items && weight && !!photo && !!safeId;
  const mReady = mReason && mNote.trim().length >= MIN_NARRATION && !!mPhoto;

  const tick = (on, set, text) => (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
      background: on ? "#e2f2e9" : "#fdf1d8", border: "1px solid " + (on ? "#9bcfb3" : "#e8cf9a"),
      borderRadius: 10, padding: "11px 13px", marginBottom: 8 }}>
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 1, flex: "0 0 auto" }} />
      <span style={{ fontSize: 13.5, fontWeight: 700, color: on ? "#1e7a4f" : "#a06407" }}>{text}</span>
    </label>
  );

  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #slf-tag, #slf-tag * { visibility: visible !important; }
        #slf-tag { position: fixed; left: 0; top: 0; margin: 0; border: none; }
      }`}</style>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 17 }}>{p.customerName}</div>
        <div className="mono" style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 3 }}>
          {p.loanNo} · packet {p.packetNo} · {grams} g · {p.pieceCount} piece{p.pieceCount === 1 ? "" : "s"}
        </div>
      </div>

      {/* ————————————————— 1 ————————————————— */}
      <h2 style={{ fontSize: 15, fontWeight: 900, margin: "0 0 10px" }}>
        1 · Recheck against the appraisal note</h2>
      {tick(seal, setSeal, "Yesterday's seal was intact when the packet was opened")}
      {tick(items, setItems, "Item count and description match the appraisal note")}
      {tick(weight, setWeight, `Net weight re-checked on the scale — ${grams} g`)}

      {/* ————————————————— 2 ————————————————— */}
      <h2 style={{ fontSize: 15, fontWeight: 900, margin: "22px 0 10px" }}>
        2 · Seal the packet &amp; tag it</h2>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div id="slf-tag" style={{ width: "50mm", height: "75mm", border: "1px solid #cfc9ba",
          borderRadius: 6, padding: "4mm", background: "#fff", display: "flex",
          flexDirection: "column", justifyContent: "space-between", fontSize: 9 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 11 }}>SLF · {p.branchCode}</div>
            <div className="mono" style={{ fontWeight: 900, fontSize: 12, marginTop: 2 }}>{p.packetNo}</div>
          </div>
          <div style={{ alignSelf: "center", width: "26mm", height: "26mm", border: "1px solid #333",
            display: "grid", placeItems: "center", textAlign: "center", padding: 3 }}>
            <span className="mono" style={{ fontSize: 6, wordBreak: "break-all" }}>
              {qrPayload({ packetNo: p.packetNo, loanNo: p.loanNo, branchCode: p.branchCode })}</span>
          </div>
          <div>
            <div style={{ fontWeight: 800 }}>{p.customerName}</div>
            <div className="mono">{p.loanNo}</div>
            <div className="mono" style={{ marginTop: 2 }}>{grams} g · {today()}</div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <button type="button" className="btn ghost" onClick={() => window.print()}>🖨 Print QR tag</button>
          <PhotoInput kind="seal" label="📷 Capture sealed-packet photo" value={photo} onChange={setPhoto}
            hint="Photograph the packet after it is sealed, with the tag visible." />
        </div>
      </div>

      {/* ————————————————— 3 ————————————————— */}
      <h2 style={{ fontSize: 15, fontWeight: 900, margin: "22px 0 10px" }}>3 · Safe entry</h2>
      {safes.length === 0
        ? <div className="card"><span className="chip warn">No safe is defined for this branch</span>
            <p style={{ marginTop: 8, fontSize: 13.5, color: "var(--mut)" }}>
              Head Office must add a safe before gold can be vaulted here.</p></div>
        : <>
            <label className="f">Safe / locker</label>
            <select value={safeId} onChange={e => setSafeId(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #cfc9ba",
                fontSize: 15, minWidth: 260, background: "#fff" }}>
              <option value="">Choose…</option>
              {safes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </>}
      <p className="hint" style={{ marginTop: 8 }}>
        Single-user action per policy. Logged against your login with a timestamp.</p>

      {err && <div style={{ marginTop: 12 }}><span className="chip bad">{err}</span></div>}
      <TopNotice notice={err} onClose={() => setErr(null)} />

      <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn" disabled={!ready || busy}
          style={{ opacity: ready && !busy ? 1 : .45, cursor: ready && !busy ? "pointer" : "not-allowed" }}
          onClick={() => send({ action: "vault_in", sealIntact: seal, itemsMatch: items,
            weightMatch: weight, sealPhotoFileId: photo?.fileId, safeId: Number(safeId) })}>
          {busy ? "Saving…" : `Confirm packet in ${chosenSafe ? chosenSafe.label : "the safe"} →`}
        </button>
        <button type="button" className="btn ghost" onClick={() => setShowMismatch(v => !v)}
          style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>
          Report a mismatch
        </button>
      </div>

      {/* ————————————— mismatch (O10) ————————————— */}
      {showMismatch && (
        <div className="card" style={{ marginTop: 16, borderColor: "var(--bad)" }}>
          <h2 style={{ fontSize: 15, fontWeight: 900, margin: "0 0 6px" }}>Report a mismatch</h2>
          <p style={{ fontSize: 13.5, color: "var(--mut)", margin: "0 0 12px" }}>
            The packet will <b>not</b> go into a safe. It is frozen where it is, and Head Office
            will see it. This record cannot be edited or deleted afterwards.
          </p>

          <label className="f">What did not match?</label>
          <select value={mReason} onChange={e => setMReason(e.target.value)}
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #cfc9ba",
              fontSize: 15, minWidth: 300, background: "#fff" }}>
            <option value="">Choose…</option>
            {MISMATCH_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>

          <label className="f" style={{ marginTop: 14 }}>What exactly did you find?</label>
          <textarea value={mNote} onChange={e => setMNote(e.target.value)} rows={4}
            placeholder="Describe it plainly — what you saw, what the note said, who else was present."
            style={{ width: "100%", maxWidth: 620, padding: "10px 12px", borderRadius: 10,
              border: "1px solid #cfc9ba", fontSize: 15, fontFamily: "inherit" }} />
          <div className="hint">{mNote.trim().length}/{MIN_NARRATION} characters minimum</div>

          <div style={{ marginTop: 14 }}>
            <PhotoInput kind="seal" label="📷 Photograph what you found" value={mPhoto} onChange={setMPhoto}
              hint="This photograph is the evidence. It cannot be replaced later." />
          </div>

          <div style={{ marginTop: 16 }}>
            <button className="btn" disabled={!mReady || busy}
              style={{ background: "var(--bad)", opacity: mReady && !busy ? 1 : .45,
                cursor: mReady && !busy ? "pointer" : "not-allowed" }}
              onClick={() => send({ action: "mismatch", reason: mReason, note: mNote,
                photoFileId: mPhoto?.fileId })}>
              {busy ? "Saving…" : "Freeze this packet & notify Head Office"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
