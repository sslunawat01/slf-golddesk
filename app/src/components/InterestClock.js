/**
 * E36 (owner, 15 Oct 2026) — the interest clock in DAYS, worded once and used
 * on the loan page, the collect screen and the receipt. Server- and
 * client-safe: plain props, no hooks.
 *
 *   cov = interestCoverage() from the engine:
 *     paidUpTo · paidDaysTotal · dueDays · dueFrom · dueTo · interestDuePaise · advanceDays · cycleDays
 */
const dmy = (iso) => { const s = String(iso || "").slice(0, 10).split("-"); return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : "—"; };
const inrP = (p) => "₹" + Math.round(Number(p || 0) / 100).toLocaleString("en-IN");
const days = (n) => `${n} day${n === 1 ? "" : "s"}`;

export function clockWords(cov) {
  if (!cov) return null;
  const paid = cov.paidDaysTotal > 0
    ? `Interest paid up to ${dmy(cov.paidUpTo)} (${days(cov.paidDaysTotal)})`
    : "No interest paid yet";
  if (cov.advanceDays > 0)
    return { tone: "ok", paid, due: `${days(cov.advanceDays)} paid in advance — nothing due until ${dmy(cov.paidUpTo)}` };
  if (cov.dueDays === 0)
    return { tone: "ok", paid, due: "Nothing due today" };
  return { tone: cov.dueDays > 30 ? "bad" : "warn", paid,
    due: `Due for ${days(cov.dueDays)} — ${dmy(cov.dueFrom)} to ${dmy(cov.dueTo)} · ${inrP(cov.interestDuePaise)}` };
}

const TONE = {
  ok:   { bg: "#e2f2e9", line: "#9bcfb3", fg: "#1e7a4f" },
  warn: { bg: "#fdf1d8", line: "#f0d9a4", fg: "#a06407" },
  bad:  { bg: "#fbe6e2", line: "#f0b8b0", fg: "#b03426" },
};

/** The two-line strip. `compact` drops the heading. */
export default function InterestClock({ cov, compact = false, style }) {
  const w = clockWords(cov);
  if (!w) return null;
  const t = TONE[w.tone];
  return (
    <div data-interest-clock={w.tone} style={{ background: t.bg, border: `1px solid ${t.line}`, borderRadius: 12,
      padding: compact ? "8px 12px" : "10px 14px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", ...style }}>
      {!compact && <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: t.fg }}>Interest clock</div>}
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#2f3a33" }} data-clock-paid>✓ {w.paid}</div>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: t.fg }} data-clock-due>{w.tone === "ok" ? "✓" : "●"} {w.due}</div>
    </div>
  );
}
