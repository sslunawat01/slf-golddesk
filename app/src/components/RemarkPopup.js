"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * E32 №5 (owner, 15 Oct 2026) — the customer's standing remark, shown as a
 * pop-up the operator must dismiss. Red for a BLACKLIST (lending is blocked),
 * amber for a WARNING. Mounted wherever the customer is opened, paid or
 * pledged; shown once per mount (every screen, every branch).
 *
 * `entries`: [{ kind: "blacklist"|"warning", name, custNo, remark }]
 */
export default function RemarkPopup({ entries = [], onClose }) {
  const [open, setOpen] = useState(false);
  const list = entries.filter(e => e && e.remark);
  const key = list.map(e => `${e.kind}:${e.custNo}:${e.remark}`).join("|");
  useEffect(() => { setOpen(list.length > 0); }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || typeof document === "undefined") return null;
  const black = list.some(e => e.kind === "blacklist");
  const tone = black ? { bg: "#fdecea", line: "#b03426", title: "BLACKLISTED — no new loan" }
                     : { bg: "#fff4d6", line: "#b8860b", title: "WARNING on this customer" };
  return createPortal(
    <div data-remark-popup style={{ position: "fixed", inset: 0, background: "rgba(12,35,27,.72)",
      zIndex: 10040, display: "grid", placeItems: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ background: tone.bg, borderLeft: `8px solid ${tone.line}`, borderRadius: "6px 18px 18px 6px",
        padding: "20px 22px", maxWidth: 560, width: "100%", boxShadow: "0 18px 50px rgba(0,0,0,.35)" }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: tone.line, letterSpacing: "-.2px" }}>{tone.title}</div>
        {list.map((e, i) => (
          <div key={i} style={{ marginTop: 12, borderTop: i ? "1px solid rgba(0,0,0,.08)" : 0, paddingTop: i ? 10 : 0 }}>
            <div style={{ fontWeight: 800 }}>{e.name} <span className="mono" style={{ color: "var(--mut)", fontSize: 12.5 }}>{e.custNo}</span>
              {" "}<span className={"chip " + (e.kind === "blacklist" ? "bad" : "warn")}>{e.kind}</span></div>
            <div style={{ marginTop: 6, fontSize: 15, whiteSpace: "pre-wrap" }}>{e.remark}</div>
          </div>))}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" className="btn green" autoFocus
            onClick={() => { setOpen(false); onClose?.(); }}
            style={{ fontSize: 15, padding: "10px 22px", fontWeight: 900 }}>Noted</button>
        </div>
      </div>
    </div>, document.body);
}
