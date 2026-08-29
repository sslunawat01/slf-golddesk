"use client";
import { useEffect, useRef, useState } from "react";

/**
 * E20 №1 (owner, 29 Aug 2026): every date is typed as DD-MM-YYYY — two-digit
 * day, two-digit month, four-digit year, hyphens appear by themselves. The
 * little 📅 opens the browser's calendar as a shortcut; either way the value
 * handed to the app stays ISO (yyyy-mm-dd), so no logic changes anywhere.
 */
const toDmy = (iso) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}-${m}-${y}` : "";
};
const toIso = (dmy) => {
  const m = dmy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const dt = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  // reject impossible dates like 31-02: the Date object silently rolls over
  if (dt.getUTCDate() !== Number(dd) || dt.getUTCMonth() + 1 !== Number(mm)) return null;
  return `${yyyy}-${mm}-${dd}`;
};

export default function DateInput({ value, onChange, min, max, style, className = "i", disabled }) {
  const [text, setText] = useState(toDmy(value));
  const [bad, setBad] = useState(false);
  const nativeRef = useRef(null);

  useEffect(() => { setText(toDmy(value)); setBad(false); }, [value]);

  function type(raw) {
    // digits only; hyphens place themselves after DD and MM
    const d = raw.replace(/\D/g, "").slice(0, 8);
    const out = d.length <= 2 ? d
      : d.length <= 4 ? `${d.slice(0, 2)}-${d.slice(2)}`
      : `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
    setText(out);
    if (out.length === 10) {
      const iso = toIso(out);
      if (iso) { setBad(false); onChange(iso); }
      else setBad(true);
    } else { setBad(false); if (!out) onChange(""); }
  }

  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center", ...style }}>
      <input className={className} inputMode="numeric" placeholder="DD-MM-YYYY" maxLength={10}
        value={text} disabled={disabled} onChange={(e) => type(e.target.value)}
        onBlur={() => { if (text && text.length < 10) setBad(true); }}
        style={{ letterSpacing: ".04em", width: 130,
          borderColor: bad ? "var(--bad)" : undefined }} />
      <button type="button" disabled={disabled} title="Pick from calendar"
        onClick={() => { try { nativeRef.current?.showPicker(); } catch { nativeRef.current?.click(); } }}
        style={{ border: "1px solid #cfc9ba", background: "#fff", borderRadius: 8,
          padding: "7px 9px", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>📅</button>
      <input ref={nativeRef} type="date" value={value || ""} min={min} max={max} tabIndex={-1}
        onChange={(e) => { setBad(false); onChange(e.target.value); }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      {bad && <span className="chip bad" style={{ fontSize: 11 }}>DD-MM-YYYY</span>}
    </span>
  );
}
