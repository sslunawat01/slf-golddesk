"use client";
import { useRef, useState } from "react";

/**
 * Camera/file capture that compresses BEFORE upload.
 * Ornament and KYC photos come off tablets at 4-8 MB; branches run on modest
 * connections, so we resize to 1600px (≈250 KB) plus a 320px thumbnail and
 * send those. The original never leaves the device.
 */
async function compress(file, maxEdge, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { dataUrl: canvas.toDataURL("image/jpeg", quality), width: w, height: h };
}

export default function PhotoInput({ kind, label, square = false, multiple = false,
                                     value, onChange, hint, compact = false }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const files = Array.isArray(value) ? value : value ? [value] : [];

  async function pick(e) {
    const chosen = Array.from(e.target.files || []);
    if (!chosen.length) return;
    setBusy(true); setErr(null);
    try {
      const ids = [];
      for (const f of chosen) {
        const main = await compress(f, 1600, 0.72);
        const thumb = await compress(f, 320, 0.7);
        const r = await fetch("/api/files", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, dataUrl: main.dataUrl, thumbDataUrl: thumb.dataUrl,
                                 width: main.width, height: main.height }),
        }).then(r => r.json());
        if (!r.ok) throw new Error(r.reason || "upload failed");
        ids.push({ fileId: r.fileId, preview: thumb.dataUrl, kb: Math.round(r.bytes / 1024) });
      }
      onChange(multiple ? [...files, ...ids] : ids[0]);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
    if (ref.current) ref.current.value = "";
  }

  const box = compact
    ? { width: 34, height: 34, borderRadius: 8 }
    : square ? { width: 128, height: 128, borderRadius: 14 }
             : { width: 96, height: 72, borderRadius: 10 };

  if (compact) return (
    <>
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} title="add photo"
        style={{ border: "1px solid #cfc9ba", background: "#fff", borderRadius: 9, padding: "6px 10px",
          minHeight: 34, cursor: "pointer", fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>
        {busy ? "…" : "📷"}</button>
      {err && <span className="chip bad" style={{ marginLeft: 6 }}>{err}</span>}
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple={multiple}
        style={{ display: "none" }} onChange={pick} />
    </>);

  return (
    <div>
      {label && <label className="f">{label}</label>}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {files.map((f, i) => (
          <div key={f.fileId} style={{ position: "relative" }}>
            <img src={f.preview} alt="" style={{ ...box, objectFit: "cover",
              border: "2px solid var(--ok)", display: "block" }} />
            <button type="button" onClick={() => onChange(multiple ? files.filter((_, j) => j !== i) : null)}
              style={{ position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%",
                border: 0, background: "var(--bad)", color: "#fff", cursor: "pointer", fontSize: 13,
                fontWeight: 900, lineHeight: 1 }}>×</button>
            <div style={{ fontSize: 10, color: "var(--mut)", textAlign: "center", marginTop: 2 }}>{f.kb} KB</div>
          </div>
        ))}
        {(multiple || files.length === 0) && (
          <button type="button" disabled={busy} onClick={() => ref.current?.click()}
            style={{ ...box, border: "2px dashed #cfc9ba", background: "#faf9f4", cursor: "pointer",
                     color: "var(--mut)", fontSize: 12, fontWeight: 700, display: "grid",
                     placeItems: "center", padding: 6, textAlign: "center" }}>
            {busy ? "uploading…" : files.length ? "+ add" : "📷 capture"}
          </button>
        )}
      </div>
      {hint && <div className="hint" style={{ marginTop: 6 }}>{hint}</div>}
      {err && <div style={{ marginTop: 6 }}><span className="chip bad">{err}</span></div>}
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple={multiple}
        style={{ display: "none" }} onChange={pick} />
    </div>
  );
}
