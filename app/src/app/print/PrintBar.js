"use client";
/** The only interactive element on a print page — everything else is paper. */
export default function PrintBar({ backHref }) {
  return (
    <div className="noprint" style={{ display: "flex", justifyContent: "space-between",
      alignItems: "center", maxWidth: 820, margin: "14px auto 0", padding: "0 10px" }}>
      <a href={backHref} style={{ color: "#7d786c", fontSize: 13, fontWeight: 700,
        textDecoration: "none" }}>← back</a>
      <button onClick={() => window.print()}
        style={{ background: "#e0a63a", color: "#0c231b", border: 0, padding: "11px 20px",
          borderRadius: 11, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>🖨 Print</button>
    </div>);
}
