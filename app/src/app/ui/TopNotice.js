"use client";
/**
 * E25 (owner, 30 Aug 2026): refusals and suggestions surface at the TOP of
 * the screen — fixed, always visible — on every save and tab change, so
 * nobody scrolls to find out why a save refused.
 *
 * Render <TopNotice notice={chipOrErr} onClose={() => clear()} /> where
 * `notice` is { tone: "bad"|"warn", text } or a plain string (treated as
 * "bad"). Holds until dismissed or replaced; success stays with SavedToast.
 * Field-level chips stay in place — the banner says THAT something refused,
 * the chip says WHERE.
 */

export default function TopNotice({ notice, onClose }) {
  if (!notice) return null;
  const tone = typeof notice === "string" ? "bad" : (notice.tone || "bad");
  const text = typeof notice === "string" ? notice : notice.text;
  if (!text || tone === "ok") return null;   // successes belong to SavedToast
  const bad = tone === "bad";
  return (
    <div role="alert" data-topnotice style={{ position: "fixed", top: 64, left: "50%",
      transform: "translateX(-50%)", zIndex: 9998, maxWidth: "min(92vw, 720px)",
      display: "flex", alignItems: "flex-start", gap: 10,
      background: bad ? "var(--bad)" : "var(--warn)", color: "#fff",
      fontWeight: 800, fontSize: 14.5, lineHeight: 1.45,
      padding: "11px 14px 11px 18px", borderRadius: 12,
      boxShadow: bad ? "0 6px 24px rgba(176,52,38,.4)" : "0 6px 24px rgba(160,100,7,.4)" }}>
      <span style={{ flex: 1 }}>{text}</span>
      {onClose &&
        <button onClick={onClose} aria-label="Dismiss"
          style={{ background: "transparent", border: 0, color: "#fff", fontWeight: 900,
            fontSize: 16, cursor: "pointer", padding: "0 2px", lineHeight: 1.3 }}>✕</button>}
    </div>
  );
}
