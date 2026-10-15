"use client";
import { useState } from "react";

const inr = (p) => "₹" + Math.round(Number(p || 0) / 100).toLocaleString("en-IN");
const dmy = (iso) => { const s = String(iso || "").slice(0, 10).split("-"); return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : "—"; };
const dt = (v) => v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

/**
 * E33 — one loan's follow-ups as a timeline, newest first, with the open due
 * item on top and receipts shown between entries. `data` is the response of
 * /api/followups/loan/[id].
 */
export default function FollowupTimeline({ data, filterable = true }) {
  const [chan, setChan] = useState("all");
  const items = data.items || [];
  const groups = [["all", "All", items.length],
    ["call", "Calls", items.filter(i => i.channel === "call").length],
    ["visit", "Visits", items.filter(i => i.channel === "visit").length],
    ["msg", "Messages", items.filter(i => ["sms", "whatsapp", "email", "ai_call"].includes(i.channel)).length],
    ["notice", "Notices", items.filter(i => i.channel === "notice").length]].filter(g => g[0] === "all" || g[2] > 0);
  const shown = items.filter(i => chan === "all" ? true : chan === "msg" ? ["sms", "whatsapp", "email", "ai_call"].includes(i.channel) : i.channel === chan);
  // receipts land between the entries they fall between (newest first)
  const rows = [];
  const receipts = [...(data.receipts || [])].sort((a, b) => b.on.localeCompare(a.on));
  let ri = 0;
  for (const it of shown) {
    const day = it.onDay || String(it.at).slice(0, 10);   // the IST day the API computed
    while (ri < receipts.length && receipts[ri].on > day) { rows.push({ receipt: receipts[ri] }); ri++; }
    rows.push({ item: it });
  }
  const due = data.due;
  const tone = due?.status?.state === "missed" ? { bg: "var(--bad-bg)", line: "var(--bad)", fg: "var(--bad)" }
    : due?.status?.state === "today" ? { bg: "var(--warn-bg)", line: "#f0d9a4", fg: "var(--warn)" }
    : { bg: "#eceadf", line: "var(--line)", fg: "var(--mut)" };

  return (
    <div data-fu-timeline>
      {due && (
        <div style={{ background: tone.bg, border: `1px solid ${tone.line}`, borderRadius: 12, padding: "10px 14px", marginBottom: 10 }}>
          <div style={{ fontWeight: 900, color: tone.fg }}>
            Next follow-up {due.status.state === "missed" ? `MISSED — was due ${dmy(due.dueOn)} (${due.status.days} day${due.status.days === 1 ? "" : "s"} ago)`
              : due.status.state === "today" ? `due TODAY · ${dmy(due.dueOn)}` : `due ${dmy(due.dueOn)} (${due.status.label})`}</div>
          <div style={{ fontSize: 13, color: "#5f5b4f" }}>{due.typeLabel}
            {due.ptpDate ? ` · promised ${due.ptpAmountPaise ? inr(due.ptpAmountPaise) : ""} by ${dmy(due.ptpDate)}` : ""}
            {" · set by "}{due.setBy} on {dmy(due.setOn)}{due.assignedName ? ` · for ${due.assignedName}` : " · for anyone at the branch"}</div>
        </div>)}
      {data.suggestion && (
        <div style={{ background: "#e3eef8", borderRadius: 12, padding: "8px 14px", marginBottom: 10, fontSize: 13, color: "#22608f" }}>
          <b>Suggested:</b> {data.suggestion.typeLabel} — {data.suggestion.reason}.</div>)}
      {filterable && items.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          {groups.map(([k, l, n]) => <button key={k} type="button" onClick={() => setChan(k)}
            className={"chip " + (chan === k ? "" : "mut")} style={{ border: 0, cursor: "pointer",
              background: chan === k ? "var(--vault)" : undefined, color: chan === k ? "#fff" : undefined }}>{l} · {n}</button>)}
          <span style={{ flex: "1 1 auto" }} />
          <span style={{ fontSize: 12.5, color: "var(--mut)" }}>promises: <b style={{ color: "var(--ok)" }}>{data.ptpRecord?.kept || 0} kept</b> · <b style={{ color: "var(--bad)" }}>{data.ptpRecord?.broken || 0} broken</b></span>
        </div>)}
      {items.length === 0 && <div style={{ color: "var(--mut)", fontSize: 13.5, padding: "6px 0" }}>No follow-up logged on this loan yet.</div>}
      <div className="fu-tl">
        {rows.map((r, i) => r.receipt ? (
          <div key={"r" + i} className="fu-ev" style={{ color: "var(--mut)", fontSize: 12.5 }}>
            <span className="fu-dot" style={{ background: "#cfc9ba" }} />
            <span className="mono">{dmy(r.receipt.on)}</span> · receipt <b style={{ color: "var(--ok)" }}>{inr(r.receipt.amountPaise)}</b> · {r.receipt.receiptNo}
          </div>) : (
          <div key={r.item.id} className="fu-ev" data-fu-item>
            <span className="fu-dot" style={{ background: r.item.ptp === "broken" ? "var(--bad)" : "var(--ok)" }} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="chip ok">done</span>
                <b>{r.item.typeLabel}</b>
                <span style={{ color: "var(--mut)" }}>· {r.item.channelLabel}</span>
                <span className={"chip " + (r.item.outcome === "paid" ? "ok" : r.item.outcome === "promised" ? "info" : "mut")}
                  style={r.item.outcome === "promised" ? { background: "#e3eef8", color: "#22608f" } : undefined}>{r.item.outcomeLabel}</span>
                {r.item.ptp && <span className={"chip " + (r.item.ptp === "kept" ? "ok" : r.item.ptp === "broken" ? "bad" : "warn")}>
                  PTP {r.item.ptp}{r.item.ptpAmountPaise ? ` · ${inr(r.item.ptpAmountPaise)}` : ""} · {dmy(r.item.ptpDate)}</span>}
              </div>
              <span className="mono" style={{ fontSize: 12, color: "var(--mut)" }}>{dt(r.item.at)} · {r.item.by}</span>
            </div>
            {r.item.remark && <div style={{ fontSize: 13.5, color: "#4a4d42", marginTop: 4, whiteSpace: "pre-wrap" }}>{r.item.remark}</div>}
            {r.item.nextFollowUp && <div style={{ fontSize: 12, color: "var(--mut)", marginTop: 3 }}>
              → next set for {dmy(r.item.nextFollowUp)} ({r.item.nextTypeLabel || "follow-up"}{r.item.assignedName ? ` · ${r.item.assignedName}` : ""})</div>}
          </div>))}
      </div>
    </div>
  );
}
