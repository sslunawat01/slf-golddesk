"use client";
import { useEffect, useState } from "react";
import DateInput from "@/components/DateInput.js";
import { TYPES, CHANNELS, OUTCOMES, CHANNEL_SENDS, QUICK_PHRASES, addDays, whatsappLink } from "@/lib/followups.js";

const inr = (p) => "₹" + Math.round(Number(p || 0) / 100).toLocaleString("en-IN");
const dmy = (iso) => { const s = String(iso || "").slice(0, 10).split("-"); return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : "—"; };

/**
 * E33 — the one logging form, used on the loan page and in the tab's panel.
 * Five tap-rows, one typed remark. Posts to /api/followups.
 *   loan: { id, loanNo, customer, mobile, dueTodayPaise }
 *   due:  the open due item (or null) — pre-selects the type and names what is being cleared
 *   defaultType: the type to start on when there is no due item (the system's suggestion)
 *   staff: [{id,name}] · me: employeeId · today: 'YYYY-MM-DD'
 *   onSaved(result, { next:bool }) — the host decides what happens after (reload, next row…)
 */
export default function FollowupLogForm({ loan, due = null, defaultType = null, staff = [], me, today, onSaved, onCancel,
                                          showNext = true, compact = false, nextLabel = null }) {
  const [f, setF] = useState({ type: due?.type || defaultType || "interest", channel: "call", outcome: "",
    remark: "", ptpAmount: due?.ptpAmountPaise ? String(due.ptpAmountPaise / 100) : "", ptpDate: "",
    nextPick: "", nextDate: "", nextType: "", assignedTo: String(me || "") });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => { setF(x => ({ ...x, type: due?.type || defaultType || x.type, ptpAmount: due?.ptpAmountPaise ? String(due.ptpAmountPaise / 100) : x.ptpAmount })); }, [due?.type, due?.ptpAmountPaise, defaultType]);

  const set = (p) => setF(x => ({ ...x, ...p }));
  const nextDate = f.nextPick === "tomorrow" ? addDays(today, 1) : f.nextPick === "+3" ? addDays(today, 3)
    : f.nextPick === "+7" ? addDays(today, 7) : f.nextPick === "ptp" ? f.ptpDate : f.nextPick === "pick" ? f.nextDate : "";
  const promised = f.outcome === "promised";
  const ptpAmountPaise = Math.round(Number(String(f.ptpAmount).replace(/[^\d]/g, "") || 0) * 100);
  const sendNote = CHANNEL_SENDS[f.channel];
  const wa = f.channel === "whatsapp" ? whatsappLink(loan.mobile,
    `Namaste ${loan.customer}, this is S Lunawat Finance about your gold loan ${loan.loanNo}. Amount due today ${inr(loan.dueTodayPaise)}. Please visit the branch or call us.`) : null;

  async function save(next) {
    setBusy(true); setErr(null);
    const body = { loanId: loan.id, type: f.type, channel: f.channel, outcome: f.outcome, remark: f.remark,
      ptpDate: promised ? f.ptpDate : null, ptpAmountPaise: promised ? ptpAmountPaise : null,
      nextFollowUp: nextDate || null, nextType: f.nextType || (promised ? "ptp" : f.type),
      assignedTo: f.assignedTo ? Number(f.assignedTo) : null };
    const r = await fetch("/api/followups", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body) }).then(x => x.json()).catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    onSaved?.(r, { next });
  }

  const Pill = ({ on, onClick, children, title, disabled }) => (
    <button type="button" onClick={onClick} title={title} disabled={disabled} data-pill={on ? "on" : "off"}
      className={"fu-pill" + (on ? " on" : "")}>{children}</button>);
  const K = ({ children }) => <label className="f" style={{ marginBottom: 6 }}>{children}</label>;

  return (
    <div className="fu-form" data-fu-form style={{ display: "grid", gap: compact ? 12 : 16 }}>
      {due && <div style={{ background: "var(--warn-bg)", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, color: "#5f5b4f" }}>
        <b style={{ color: "var(--warn)" }}>Clears the due item:</b> {due.typeLabel} · {dmy(due.dueOn)}
        {due.ptpDate ? ` · promised ${due.ptpAmountPaise ? inr(due.ptpAmountPaise) : ""} by ${dmy(due.ptpDate)}` : ""}</div>}

      <div><K>1 · What is this follow-up about?</K>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TYPES.map(([k, l]) => <Pill key={k} on={f.type === k} onClick={() => set({ type: k })}>{l}</Pill>)}
        </div></div>

      <div><K>2 · How did you reach them?</K>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CHANNELS.map(([k, l]) => <Pill key={k} on={f.channel === k} onClick={() => set({ channel: k })}>{l}</Pill>)}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          {loan.mobile && <a href={`tel:${loan.mobile}`} className="btn ghost" style={{ padding: "7px 12px", fontSize: 13, textDecoration: "none" }}>📞 Call {loan.mobile}</a>}
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="btn ghost" style={{ padding: "7px 12px", fontSize: 13, textDecoration: "none" }}>Open WhatsApp with the reminder text →</a>}
          {sendNote && <span className="chip warn" style={{ fontSize: 11.5 }}>logs only — {sendNote} not connected yet</span>}
        </div></div>

      <div><K>3 · What happened?</K>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {OUTCOMES.map(([k, l]) => <Pill key={k} on={f.outcome === k} onClick={() => set({ outcome: k, nextPick: k === "promised" && f.nextPick === "" ? "ptp" : f.nextPick })}>{l}</Pill>)}
        </div>
        {promised && (
          <div style={{ marginTop: 8, background: "#e3eef8", borderRadius: 12, padding: "10px 12px", display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, maxWidth: 560 }}>
            <div><label className="f" style={{ color: "#22608f" }}>Promised amount ₹</label>
              <input className="i mono" inputMode="numeric" value={f.ptpAmount} data-ptp-amount
                onChange={e => set({ ptpAmount: e.target.value.replace(/[^\d]/g, "") })} placeholder="e.g. 20000" /></div>
            <div><label className="f" style={{ color: "#22608f" }}>Promised by (date)</label>
              <DateInput value={f.ptpDate} onChange={v => set({ ptpDate: v })} /></div>
            <div style={{ alignSelf: "end", fontSize: 12, color: "#22608f", paddingBottom: 8 }}>Marked kept or broken by the system from the receipts.</div>
          </div>)}
      </div>

      <div><K>4 · Remark</K>
        <textarea className="i" rows={compact ? 2 : 3} value={f.remark} maxLength={1000} data-fu-remark
          onChange={e => set({ remark: e.target.value })} placeholder="What was said, what was agreed" />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--mut)" }}>Quick:</span>
          {QUICK_PHRASES.map(p => <button key={p} type="button" className="fu-pill small"
            onClick={() => set({ remark: (f.remark ? f.remark.replace(/\s*$/, "") + ". " : "") + p })}>{p}</button>)}
        </div></div>

      {showNext && (
        <div><K>5 · Next follow-up</K>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["tomorrow", "Tomorrow"], ["+3", "+3 days"], ["+7", "+7 days"],
              ...(promised && f.ptpDate ? [["ptp", `On PTP day · ${dmy(f.ptpDate)}`]] : []),
              ["pick", "Pick a date"], ["", "No further follow-up"]].map(([k, l]) =>
              <Pill key={k || "none"} on={f.nextPick === k} onClick={() => set({ nextPick: k })}>{l}</Pill>)}
          </div>
          {f.nextPick === "pick" && <div style={{ marginTop: 8 }}><DateInput value={f.nextDate} onChange={v => set({ nextDate: v })} /></div>}
          {nextDate && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, maxWidth: 560 }}>
              <div><label className="f">Next type</label>
                <select className="i" value={f.nextType || (promised ? "ptp" : f.type)} onChange={e => set({ nextType: e.target.value })} data-next-type>
                  {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label className="f">Assign to</label>
                <select className="i" value={f.assignedTo} onChange={e => set({ assignedTo: e.target.value })} data-assign>
                  <option value="">Anyone at the branch</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{Number(s.id) === Number(me) ? `Me (${s.name})` : s.name}</option>)}</select></div>
              <div style={{ alignSelf: "end", fontSize: 12.5, color: "var(--mut)", paddingBottom: 10 }}>due {dmy(nextDate)}</div>
            </div>)}
        </div>)}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap",
        borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div style={{ fontSize: 12, color: "var(--mut)" }}>Saved as a permanent record under your name · {dmy(today)}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {err && <span className="chip bad">{err}</span>}
          {onCancel && <button type="button" className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>}
          <button type="button" className={"btn " + (nextLabel ? "ghost" : "green")} disabled={busy || !f.outcome} onClick={() => save(false)} data-fu-save>
            {busy ? "Saving…" : "Save follow-up"}</button>
          {nextLabel && <button type="button" className="btn green" disabled={busy || !f.outcome} onClick={() => save(true)} data-fu-save-next>
            {busy ? "Saving…" : nextLabel}</button>}
        </div>
      </div>
    </div>
  );
}
