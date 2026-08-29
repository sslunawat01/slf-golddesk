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

  const [cam, setCam] = useState(null);           // MediaStream while the camera modal is open
  const videoRef = useRef(null);

  /**
   * E20 №2 (owner, 29 Aug 2026): a real Camera option everywhere — the browser
   * asks permission once and remembers the grant for this site; tablets get
   * the back camera by default (facingMode environment).
   */
  async function openCamera() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
      setCam(stream);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50);
    } catch {
      setErr("Camera not allowed — permit it in the browser, or choose a file");
    }
  }
  function closeCamera() { cam?.getTracks().forEach(t => t.stop()); setCam(null); }
  const [edit, setEdit] = useState(null);   // E21 №1: { dataUrl, rot, crop } after a snap
  const editImgRef = useRef(null);
  const dragRef = useRef(null);

  async function snap() {
    const v = videoRef.current; if (!v) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext("2d").drawImage(v, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    closeCamera();
    setEdit({ dataUrl, rot: 0, crop: null });   // №1: edit before upload
  }

  // crop drag — pointer coordinates in the displayed image's own space
  function cropStart(e) {
    const img = editImgRef.current; if (!img) return;
    const r = img.getBoundingClientRect();
    const pt = e.touches ? e.touches[0] : e;
    dragRef.current = { x0: pt.clientX - r.left, y0: pt.clientY - r.top, rect: r };
    setEdit(ed => ({ ...ed, crop: null }));
  }
  function cropMove(e) {
    if (!dragRef.current) return;
    const { x0, y0, rect } = dragRef.current;
    const pt = e.touches ? e.touches[0] : e;
    const x1 = Math.min(Math.max(pt.clientX - rect.left, 0), rect.width);
    const y1 = Math.min(Math.max(pt.clientY - rect.top, 0), rect.height);
    setEdit(ed => ({ ...ed, crop: {
      x: Math.min(x0, x1) / rect.width, y: Math.min(y0, y1) / rect.height,
      w: Math.abs(x1 - x0) / rect.width, h: Math.abs(y1 - y0) / rect.height } }));
  }
  function cropEnd() {
    if (dragRef.current) {
      dragRef.current = null;
      setEdit(ed => (ed?.crop && (ed.crop.w < 0.05 || ed.crop.h < 0.05))
        ? { ...ed, crop: null } : ed);   // a stray tap is not a crop
    }
  }

  async function useEdited() {
    const ed = edit; if (!ed) return;
    const img = new Image();
    await new Promise(res => { img.onload = res; img.src = ed.dataUrl; });
    let out;
    if (ed.crop) {
      const c = ed.crop;
      const cx = Math.round(c.x * img.width), cy = Math.round(c.y * img.height);
      const cw = Math.max(1, Math.round(c.w * img.width));
      const ch = Math.max(1, Math.round(c.h * img.height));
      out = document.createElement("canvas");
      out.width = cw; out.height = ch;
      out.getContext("2d").drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
    } else {
      out = document.createElement("canvas");
      out.width = img.width; out.height = img.height;
      out.getContext("2d").drawImage(img, 0, 0);
    }
    const blob = await new Promise(res => out.toBlob(res, "image/jpeg", 0.95));
    setEdit(null);
    // the normal path — compression to 1600px + 320px thumb happens inside pick()
    await pick({ target: { files: [new File([blob], "camera.jpg", { type: "image/jpeg" })] } });
  }

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
    if (ref.current && e?.target === ref.current) ref.current.value = "";
  }

  const editorModal = edit && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,35,27,.88)", zIndex: 61,
      display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 14, maxWidth: 600, width: "100%" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "var(--mut)", marginBottom: 8 }}>
          Drag on the photo to crop · ↻ to rotate</div>
        <div style={{ position: "relative", display: "inline-block", maxWidth: "100%",
          touchAction: "none", userSelect: "none" }}
          onMouseDown={cropStart} onMouseMove={cropMove} onMouseUp={cropEnd} onMouseLeave={cropEnd}
          onTouchStart={cropStart} onTouchMove={cropMove} onTouchEnd={cropEnd}>
          <img ref={editImgRef} src={edit.dataUrl} alt="captured" draggable={false}
            style={{ maxWidth: "100%", maxHeight: "56vh", display: "block", borderRadius: 10 }} />
          {edit.crop && (
            <div style={{ position: "absolute", border: "2px dashed #e8a020",
              background: "rgba(232,160,32,.15)", pointerEvents: "none",
              left: `${edit.crop.x * 100}%`, top: `${edit.crop.y * 100}%`,
              width: `${edit.crop.w * 100}%`, height: `${edit.crop.h * 100}%` }} />)}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10,
          flexWrap: "wrap" }}>
          <span>
            <button type="button" className="btn ghost" onClick={async () => {
              const ed = edit; if (!ed) return;
              const img = new Image();
              await new Promise(res => { img.onload = res; img.src = ed.dataUrl; });
              const c2 = document.createElement("canvas");
              c2.width = img.height; c2.height = img.width;
              const cc = c2.getContext("2d");
              cc.translate(c2.width / 2, c2.height / 2);
              cc.rotate(Math.PI / 2);
              cc.drawImage(img, -img.width / 2, -img.height / 2);
              setEdit({ dataUrl: c2.toDataURL("image/jpeg", 0.95), rot: 0,
                crop: null, orig: ed.orig || ed.dataUrl });
            }}>↻ Rotate</button>
            <button type="button" className="btn ghost" style={{ marginLeft: 6 }}
              onClick={() => setEdit(ed => ({ dataUrl: ed.orig || ed.dataUrl, rot: 0,
                crop: null, orig: ed.orig || ed.dataUrl }))}>Reset</button>
          </span>
          <span>
            <button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button type="button" className="btn green" style={{ marginLeft: 6 }}
              onClick={useEdited}>✓ Use photo</button>
          </span>
        </div>
      </div>
    </div>);

  const cameraModal = cam && (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,35,27,.85)", zIndex: 60,
      display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 14, maxWidth: 560, width: "100%" }}>
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: "100%", borderRadius: 12, background: "#000" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <button type="button" className="btn ghost" onClick={closeCamera}>Cancel</button>
          <button type="button" className="btn green" onClick={snap}>📸 Take photo</button>
        </div>
      </div>
    </div>);

  const box = compact
    ? { width: 34, height: 34, borderRadius: 8 }
    : square ? { width: 128, height: 128, borderRadius: 14 }
             : { width: 96, height: 72, borderRadius: 10 };

  if (compact) return (
    <>
      {cameraModal}{editorModal}
      <button type="button" disabled={busy} onClick={openCamera} title="use the camera"
        style={{ border: "1px solid #cfc9ba", background: "#fff", borderRadius: 9,
          padding: "6px 8px", minHeight: 34, cursor: "pointer", fontSize: 13, marginRight: 4 }}>
        📸</button>
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} title="choose a file"
        style={{ border: "1px solid #cfc9ba", background: "#fff", borderRadius: 9, padding: "6px 10px",
          minHeight: 34, cursor: "pointer", fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>
        {/* E16 №3/№7 (owner, 29 Aug 2026): a bare camera icon is invisible —
            compact mode now says what the button does when a label is given */}
        {busy ? "…" : (label ? `📷 ${label}` : "📷")}</button>
      {err && <span className="chip bad" style={{ marginLeft: 6 }}>{err}</span>}
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple={multiple}
        style={{ display: "none" }} onChange={pick} />
    </>);

  return (
    <div>
      {cameraModal}{editorModal}
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
        {(multiple || files.length === 0) && (<>
          <button type="button" disabled={busy} onClick={openCamera}
          style={{ border: "1px dashed #b9b29e", background: "#fff", borderRadius: 10,
            padding: "9px 13px", cursor: "pointer", fontSize: 13.5, fontWeight: 800 }}>
          📸 Camera</button>
        <button type="button" disabled={busy} onClick={() => ref.current?.click()}
            style={{ ...box, border: "2px dashed #cfc9ba", background: "#faf9f4", cursor: "pointer",
                     color: "var(--mut)", fontSize: 12, fontWeight: 700, display: "grid",
                     placeItems: "center", padding: 6, textAlign: "center" }}>
            {busy ? "uploading…" : files.length ? "+ add" : "📷 choose file"}
          </button>
        </>)}
      </div>
      {hint && <div className="hint" style={{ marginTop: 6 }}>{hint}</div>}
      {err && <div style={{ marginTop: 6 }}><span className="chip bad">{err}</span></div>}
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple={multiple}
        style={{ display: "none" }} onChange={pick} />
    </div>
  );
}
