"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import DateInput from "@/components/DateInput.js";
import FollowupTimeline from "@/components/followups/FollowupTimeline.js";
import FollowupLogForm from "@/components/followups/FollowupLogForm.js";
import { TYPES, CHANNELS, groupByDay } from "@/lib/followups.js";

const inr = (p) => "₹" + Math.round(Number(p || 0) / 100).toLocaleString("en-IN");
const dmy = (iso) => { const s = String(iso || "").slice(0, 10).split("-"); return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : "—"; };
const dmyLong = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" });

/**
 * E33 — the Follow-ups tab. Opens on TODAY for the acting branch, everyone.
 * Three strokes: When (presets or a range) · Where/who (centre, assignee) ·
 * What (type chips, channel, search). History and Log open in a side panel so
 * the operator never leaves the list; "Save & next" walks down the day.
 */
export default function FollowupsClient({ branches, actingBranchId, focusLoanId = null }) {
  const [f, setF] = useState({ preset: "today", from: "", to: "", branch: String(actingBranchId), assigned: "", type: "", channel: "", q: "" });
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [panel, setPanel] = useState(null);      // { mode: 'history'|'log', loanId, row }
  const [hist, setHist] = useState(null);
  const [flash, setFlash] = useState({});        // loanId → 'saved'

  const last = useRef({ data: null, flash: {} });          // what the list showed before a refetch
  last.current = { data, flash };
  const seq = useRef(0);                                   // only the latest request may paint the list
  async function run(over = {}, { keepSaved = false } = {}) {
    const p = { ...f, ...over };
    const my = ++seq.current;
    setBusy(true); setErr(null);
    const qs = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== "" && v != null));
    const r = await fetch(`/api/followups?${qs}`).then(async res => (await res.json().catch(() => null)) ?? { ok: false, reason: `Server error ${res.status}` })
      .catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    if (my !== seq.current) return;                        // a newer filter/preset fetch is in flight
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    if (keepSaved && last.current.data) {
      // a row just logged usually leaves the range (its next date moved) — keep it in place, marked ✓ logged,
      // so the list does not shift under the operator mid-walk; a new fetch from the filters drops it
      const prev = last.current.data, fl = last.current.flash;
      const have = new Set([...(r.due || []), ...(r.suggestions || [])].map(x => x.kind + x.loanId));
      const stay = [...(prev.due || []), ...(prev.suggestions || [])].filter(x => fl[x.loanId] && !have.has(x.kind + x.loanId));
      r.due = [...(r.due || []), ...stay.filter(x => x.kind !== "suggested")];
      r.suggestions = [...(r.suggestions || []), ...stay.filter(x => x.kind === "suggested")];
    }
    setData(r);
    return r;
  }
  useEffect(() => {
    run().then(r => {
      // arrived from the Home card's "Log →": open the log panel on that loan straight away
      if (!r || !focusLoanId) return;
      const row = [...(r.due || []), ...(r.suggestions || [])].find(x => Number(x.loanId) === Number(focusLoanId));
      if (row) openPanel("log", row);
    });
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const setAndRun = (p) => { const n = { ...f, ...p }; setF(n); setFlash({}); run(n); };
  const preset = (k) => setAndRun({ preset: k, from: "", to: "" });

  async function openPanel(mode, row) {
    setPanel({ mode, loanId: row.loanId, row }); setHist(null);
    const r = await fetch(`/api/followups/loan/${row.loanId}`).then(x => x.json()).catch(() => null);
    setHist(r?.ok ? r : { ok: false, reason: r?.reason || "Could not load" });
  }

  const today = data?.today;
  const groups = useMemo(() => data ? groupByDay([...(data.due || []), ...(data.suggestions || [])], today) : null, [data, today]);
  const sugN = groups?.suggested.length || 0, sugT = data?.suggestedTotal || 0;
  const order = [["missed", "Missed", "var(--bad-bg)", "var(--bad)", "carried forward, never dropped"],
    ["today", today ? `Today · ${dmyLong(today)}` : "Today", "var(--warn-bg)", "var(--warn)", ""],
    ["suggested", "Suggested by the system", "#e3eef8", "#22608f",
      sugT > sugN ? `nobody scheduled these — ${sugN} of ${sugT} shown, most pressing first` : "nobody scheduled these — most pressing first"],
    ["tomorrow", "Tomorrow", "#eceadf", "var(--mut)", ""], ["later", "Later in the range", "#eceadf", "var(--mut)", ""]];
  const rowsFlat = groups ? [...groups.missed, ...groups.today, ...groups.suggested, ...groups.tomorrow, ...groups.later] : [];

  function afterSave(r, { next }) {
    const lid = panel.loanId;
    const fl = { ...flash, [lid]: "saved" };
    setFlash(fl); last.current = { data, flash: fl };
    run({}, { keepSaved: true });
    if (next) {
      const i = rowsFlat.findIndex(x => x.loanId === lid);
      const nxt = rowsFlat.slice(i + 1).find(x => !flash[x.loanId]);
      if (nxt) { openPanel("log", nxt); return; }
    }
    setPanel(null);
  }

  const Pill = ({ on, onClick, children }) => <button type="button" className={"fu-pill" + (on ? " on" : "")} onClick={onClick}>{children}</button>;
  const Row = ({ r }) => {
    const saved = flash[r.loanId] === "saved";
    const st = r.status;
    const chip = saved ? <span className="chip ok">✓ logged</span>
      : st.state === "missed" ? <span className="chip bad">{st.days} day{st.days === 1 ? "" : "s"} late</span>
      : st.state === "today" ? <span className="chip warn">today</span>
      : st.state === "suggested" ? <span className="chip" style={{ background: "#e3eef8", color: "#22608f" }}>suggested</span>
      : <span className="chip mut">{st.label}</span>;
    return (
      <div className="fu-row" data-fu-row={r.loanNo} style={{ background: saved ? "var(--ok-bg)" : panel?.loanId === r.loanId ? "#fffdf7" : undefined,
        outline: panel?.loanId === r.loanId ? "2px solid var(--brass)" : undefined, outlineOffset: -2 }}>
        <div className="fu-cell-due">{chip}</div>
        <div className="fu-cell-cust" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <a href={`/customers/${r.customerId}`} style={{ color: "inherit", textDecoration: "none" }}>{r.customer}</a>
            {r.blacklistRemark ? <span className="chip bad" style={{ fontSize: 10.5 }}>blacklisted</span>
              : r.warningRemark ? <span className="chip warn" style={{ fontSize: 10.5 }}>⚠ warning on file</span> : null}
          </div>
          <div className="mono" style={{ fontSize: 12.5, color: "var(--mut)" }}>
            <a href={`/loans/${r.loanId}`} style={{ color: "inherit" }}>{r.loanNo}</a> · {r.scheme} · {r.mobile}{data.scope?.startsWith("All") ? ` · ${r.branchCode}` : ""}</div>
        </div>
        <div className="fu-cell-type">{r.typeLabel}{r.ptpAmountPaise ? ` · ${inr(r.ptpAmountPaise)}` : ""}
          <div style={{ fontSize: 12, color: "var(--mut)" }}>
            {r.kind === "suggested" ? r.reason
              : r.ptpDate ? `promised by ${dmy(r.ptpDate)}${r.ptp === "broken" ? " · broken" : r.ptp === "kept" ? " · kept" : ""}`
              : `${r.unpaidDays} days interest unpaid`}</div></div>
        <div className="fu-cell-last" style={{ fontSize: 12.5, color: "var(--mut)" }}>
          {r.last ? <>{r.last.channelLabel} {dmy(r.last.onDay || r.last.at)} · {r.last.outcomeLabel}<br />{r.last.by}</> : "never contacted"}</div>
        <div className="fu-cell-num mono" style={{ fontWeight: 800 }}>{inr(r.dueTodayPaise)}</div>
        <div className="fu-cell-assigned" style={{ fontSize: 13 }}>{r.assignedTo === data.me ? "Me" : r.assignedName || <span style={{ color: "var(--mut)" }}>anyone</span>}</div>
        <div className="fu-actions">
          {r.mobile && <a href={`tel:${r.mobile}`} className="btn ghost">Call</a>}
          <button type="button" className="btn ghost" onClick={() => openPanel("history", r)} data-fu-history>History</button>
          {data.canLog && !saved && <button type="button" className="btn green" onClick={() => openPanel("log", r)} data-fu-log>Log →</button>}
        </div>
      </div>);
  };

  return (
    <div className={"fu-shell" + (panel ? " with-panel" : "")}>
      <div className={"fu-list" + (panel ? " dim" : "")}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: "-.3px" }}>Follow-ups</h1>
            <div style={{ fontSize: 13, color: "var(--mut)" }}>Who to reach, in what order, and what was promised. Opens on <b>today</b> for <b>{data?.scope || "your branch"}</b>.</div>
          </div>
          <a href="/reports/followups" className="btn ghost" style={{ padding: "9px 14px", fontSize: 13.5, textDecoration: "none" }}>Register report →</a>
        </div>

        {/* WHEN + WHERE */}
        <div className="card" style={{ padding: "14px 16px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label className="f">When</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {[["missed", "Missed", data?.counts?.missed, "bad"], ["today", "Today", data?.counts?.today, "brass"],
                ["tomorrow", "Tomorrow", data?.counts?.tomorrow, "mut"], ["week", "This week", data?.counts?.week, "mut"]].map(([k, l, n, tone]) =>
                <Pill key={k} on={f.preset === k && !f.from} onClick={() => preset(k)}>{l}
                  {n != null && <span className={"chip " + (tone === "brass" ? "" : tone)} style={{ padding: "1px 7px",
                    ...(tone === "brass" ? { background: "var(--brass)", color: "var(--vault)" } : {}) }}>{n}</span>}</Pill>)}
              <Pill on={!!f.from} onClick={() => setF({ ...f, from: f.from || today, to: f.to || today })}>Custom range</Pill>
            </div>
          </div>
          {f.from !== "" && (<>
            <div><label className="f">From</label><DateInput value={f.from} onChange={v => setF({ ...f, from: v })} /></div>
            <div><label className="f">To</label><DateInput value={f.to} onChange={v => setF({ ...f, to: v })} /></div>
            <button type="button" className="btn green" style={{ padding: "9px 14px", fontSize: 13.5 }} disabled={busy} onClick={() => { setFlash({}); run(); }}>Show</button>
          </>)}
          <div><label className="f">Centre</label>
            <select className="i" style={{ height: 40, padding: "6px 34px 6px 12px", width: 200 }} value={f.branch} onChange={e => setAndRun({ branch: e.target.value })} data-fu-branch>
              {branches.length > 1 && <option value="all">All my branches</option>}
              {branches.map(b => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}</select></div>
          <div><label className="f">Assigned to</label>
            <select className="i" style={{ height: 40, padding: "6px 34px 6px 12px", width: 190 }} value={f.assigned} onChange={e => setAndRun({ assigned: e.target.value })}>
              <option value="">Everyone</option><option value="me">Me</option><option value="none">Unassigned</option>
              {(data?.staff || []).filter(s => s.id !== data.me).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        </div>

        {/* WHAT */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "12px 0 10px" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--mut)" }}>FILTER</span>
          <button type="button" className={"chip " + (f.type ? "mut" : "")} style={{ border: 0, cursor: "pointer", background: f.type ? undefined : "var(--vault)", color: f.type ? undefined : "#fff" }}
            onClick={() => setAndRun({ type: "" })}>All types</button>
          {TYPES.map(([k, l]) => <button key={k} type="button" className={"chip " + (f.type === k ? "" : "mut")}
            style={{ border: 0, cursor: "pointer", background: f.type === k ? "var(--vault)" : undefined, color: f.type === k ? "#fff" : undefined }}
            onClick={() => setAndRun({ type: f.type === k ? "" : k })}>{l}</button>)}
          <select className="i" style={{ height: 32, padding: "2px 30px 2px 10px", fontSize: 12.5, width: 150 }} value={f.channel} onChange={e => setAndRun({ channel: e.target.value })}>
            <option value="">Any channel</option>{CHANNELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <span style={{ flex: "1 1 auto" }} />
          <input className="i" style={{ height: 36, padding: "4px 12px", fontSize: 13.5, width: 250 }} placeholder="Find customer, mobile or loan no" value={f.q}
            onChange={e => setF({ ...f, q: e.target.value })} onKeyDown={e => { if (e.key === "Enter") { setFlash({}); run(); } }} data-fu-q />
        </div>

        {err && <div style={{ marginBottom: 10 }}><span className="chip bad">{err}</span></div>}
        {!data && !err && <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>}
        {data && (
          <div className="card" style={{ padding: 0, overflow: "hidden" }} data-fu-list>
            <div className="fu-row fu-head"><span>Due</span><span>Customer · loan</span><span>Follow-up</span><span>Last contact</span><span className="fu-cell-num">Due today ₹</span><span>Assigned</span><span style={{ textAlign: "right" }}>Actions</span></div>
            {rowsFlat.length === 0 && <div style={{ padding: 18, color: "var(--mut)", fontSize: 13.5 }}>Nothing due in this range{busy ? "…" : ""}. {data.done.length > 0 && `${data.done.length} follow-up${data.done.length === 1 ? "" : "s"} logged in this range are listed below.`}</div>}
            {order.map(([k, label, bg, fg, note]) => groups[k].length > 0 && (
              <div key={k}>
                <div className="fu-group" style={{ background: bg, color: fg }}>
                  <span>{label} · {k === "suggested" && sugT > sugN ? sugT : groups[k].length}</span><span style={{ fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>{note}</span></div>
                {groups[k].map(r => <Row key={r.kind + r.loanId} r={r} />)}
              </div>))}
            {data.done.length > 0 && (
              <div>
                <div className="fu-group" style={{ background: "var(--ok-bg)", color: "var(--ok)" }}><span>Done in this range · {data.done.length}</span><span style={{ fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>stays visible so the day's work shows</span></div>
                {data.done.map(d => (
                  <div key={d.id} className="fu-row" style={{ color: "var(--mut)" }} data-fu-done={d.loanNo}>
                    <div className="fu-cell-due"><span className="chip ok">done</span></div>
                    <div className="fu-cell-cust"><div style={{ fontWeight: 800, color: "var(--ink)" }}>{d.customer}</div>
                      <div className="mono" style={{ fontSize: 12.5 }}><a href={`/loans/${d.loanId}`} style={{ color: "inherit" }}>{d.loanNo}</a> · {d.scheme}</div></div>
                    <div className="fu-cell-type">{d.typeLabel} · {d.channelLabel}<div style={{ fontSize: 12 }}>{d.outcomeLabel}{d.nextFollowUp ? ` · next ${dmy(d.nextFollowUp)}` : ""}</div></div>
                    <div className="fu-cell-last" style={{ fontSize: 12.5 }}>{dmy(d.onDay || d.at)} · {d.by}</div>
                    <div className="fu-cell-num mono" style={{ fontSize: 12.5 }}>{d.ptpAmountPaise ? `PTP ${inr(d.ptpAmountPaise)}` : "—"}</div>
                    <div className="fu-cell-assigned" style={{ fontSize: 12.5 }}>{d.assignedName || "—"}</div>
                    <div className="fu-actions"><button type="button" className="btn ghost" onClick={() => openPanel("history", { loanId: d.loanId, loanNo: d.loanNo })}>History</button></div>
                  </div>))}
              </div>)}
          </div>)}
        <div style={{ display: "flex", gap: 18, marginTop: 12, fontSize: 12.5, color: "var(--mut)", flexWrap: "wrap" }}>
          <span><b>History</b> opens the loan's full log beside the list.</span>
          <span><b>Log →</b> records a follow-up; <b>Save &amp; next</b> moves down the list.</span>
          <span><b>Missed</b> items stay until someone logs against them.</span>
        </div>
      </div>

      {panel && (
        <aside className="fu-panel" data-fu-panel={panel.mode}>
          <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="f" style={{ marginBottom: 2 }}>{panel.mode === "log" ? "Log a follow-up" : "History"}
                  {panel.mode === "log" && rowsFlat.length > 0 && ` · ${rowsFlat.findIndex(x => x.loanId === panel.loanId) + 1} of ${rowsFlat.length}`}</div>
                <div style={{ fontSize: 17, fontWeight: 900 }}>{hist?.loan?.customer || panel.row.customer || "…"}</div>
                <div className="mono" style={{ fontSize: 12.5, color: "var(--mut)" }}>{panel.row.loanNo}{hist?.loan ? ` · ${hist.loan.scheme} · ${hist.loan.custNo} · ${hist.loan.mobile}` : ""}</div>
              </div>
              <button type="button" className="btn ghost" aria-label="Close" onClick={() => setPanel(null)} style={{ padding: "6px 10px", fontSize: 16, lineHeight: 1 }} data-fu-close>✕</button>
            </div>
            {hist?.loan && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, marginTop: 10, background: "#faf9f4", borderRadius: 10, padding: "8px 10px" }}>
                <div><div className="f" style={{ margin: 0 }}>Principal</div><div className="mono" style={{ fontWeight: 900 }}>{inr(hist.loan.principalPaise)}</div></div>
                <div><div className="f" style={{ margin: 0 }}>Due today</div><div className="mono" style={{ fontWeight: 900 }}>{inr(hist.loan.dueTodayPaise)}</div></div>
                <div><div className="f" style={{ margin: 0 }}>Unpaid for</div><div className="mono" style={{ fontWeight: 900, color: hist.loan.unpaidDays > 90 ? "var(--bad)" : "inherit" }}>{hist.loan.unpaidDays} days</div></div>
                <div><div className="f" style={{ margin: 0 }}>Promises</div><div className="mono" style={{ fontWeight: 900 }}><span style={{ color: "var(--ok)" }}>{hist.ptpRecord.kept} kept</span> · <span style={{ color: "var(--bad)" }}>{hist.ptpRecord.broken} broken</span></div></div>
              </div>)}
            {hist?.loan?.warningRemark && !hist.loan.blacklistRemark && <div style={{ marginTop: 8, background: "var(--warn-bg)", borderLeft: "4px solid var(--warn)", borderRadius: "4px 10px 10px 4px", padding: "6px 10px", fontSize: 12.5 }}><b style={{ color: "var(--warn)" }}>Warning on file:</b> {hist.loan.warningRemark}</div>}
            {hist?.loan?.blacklistRemark && <div style={{ marginTop: 8, background: "var(--bad-bg)", borderLeft: "4px solid var(--bad)", borderRadius: "4px 10px 10px 4px", padding: "6px 10px", fontSize: 12.5 }}><b style={{ color: "var(--bad)" }}>Blacklisted:</b> {hist.loan.blacklistRemark}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {panel.mode === "history" && data.canLog && hist?.canLog && <button type="button" className="btn green" style={{ padding: "8px 14px", fontSize: 13.5 }} onClick={() => setPanel({ ...panel, mode: "log" })} data-fu-panel-log>Log a follow-up →</button>}
              {panel.mode === "log" && <button type="button" className="btn ghost" style={{ padding: "8px 14px", fontSize: 13.5 }} onClick={() => setPanel({ ...panel, mode: "history" })}>History ({hist?.items?.length ?? "…"})</button>}
              <a href={`/loans/${panel.loanId}`} className="btn ghost" style={{ padding: "8px 14px", fontSize: 13.5, textDecoration: "none" }}>Open loan</a>
            </div>
          </div>
          <div style={{ padding: "12px 20px 20px" }}>
            {!hist && <div style={{ color: "var(--mut)" }}>Loading…</div>}
            {hist && !hist.ok && <span className="chip bad">{hist.reason}</span>}
            {hist?.ok && panel.mode === "history" && <FollowupTimeline data={hist} />}
            {hist?.ok && panel.mode === "log" && (
              <FollowupLogForm key={panel.loanId} loan={hist.loan} due={hist.due} defaultType={panel.row.type} staff={hist.staff} me={hist.me} today={hist.today} compact
                onCancel={() => setPanel(null)} onSaved={afterSave}
                nextLabel={rowsFlat.findIndex(x => x.loanId === panel.loanId) < rowsFlat.length - 1 ? "Save & next →" : null} />)}
          </div>
        </aside>)}
    </div>
  );
}
