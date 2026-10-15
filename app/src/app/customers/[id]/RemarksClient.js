"use client";
import { useState } from "react";
import RemarkPopup from "@/components/RemarkPopup.js";

/**
 * E32 №5 — the Remarks card on the customer 360: shows the standing warning
 * and blacklist remarks (who, when), pops them up on open, and lets the
 * permitted people set or clear them.
 *   mayWarn      edit-customer right (warning remark)
 *   mayBlacklist the Blacklist permission
 */
export default function RemarksClient({ customerId, name, custNo, warning, blacklist, mayWarn, mayBlacklist }) {
  const [w, setW] = useState(warning?.remark || "");
  const [b, setB] = useState(blacklist?.remark || "");
  const [saved, setSaved] = useState({ warning, blacklist });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/customers/${customerId}/edit`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "remarks", warningRemark: w, blacklistRemark: b }) }).then(x => x.json()).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setMsg({ bad: true, text: r?.reason || "Could not save" }); return; }
    setMsg({ text: r.unchanged ? "Nothing changed" : "Saved ✓" });
    if (!r.unchanged) window.location.reload();     // the banner, the lending block and the pop-up all re-read
    setEditing(false);
  }
  const when = (x) => x?.at ? new Date(x.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "";
  const entries = [
    saved.blacklist?.remark ? { kind: "blacklist", name, custNo, remark: saved.blacklist.remark } : null,
    saved.warning?.remark ? { kind: "warning", name, custNo, remark: saved.warning.remark } : null,
  ].filter(Boolean);

  return (
    <div className="card" style={{ borderLeft: saved.blacklist?.remark ? "6px solid var(--bad)"
      : saved.warning?.remark ? "6px solid #b8860b" : undefined }}>
      <RemarkPopup entries={entries} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--mut)" }}>
          Remarks</div>
        {(mayWarn || mayBlacklist) && !editing &&
          <button type="button" className="btn ghost" onClick={() => setEditing(true)}>Edit remarks</button>}
      </div>
      {!editing && (<>
        {saved.blacklist?.remark && <div style={{ marginTop: 8 }}>
          <span className="chip bad">BLACKLISTED</span>
          <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{saved.blacklist.remark}</div>
          <div style={{ fontSize: 12, color: "var(--mut)" }}>by {saved.blacklist.by || "—"} · {when(saved.blacklist)}</div></div>}
        {saved.warning?.remark && <div style={{ marginTop: 8 }}>
          <span className="chip warn">WARNING</span>
          <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{saved.warning.remark}</div>
          <div style={{ fontSize: 12, color: "var(--mut)" }}>by {saved.warning.by || "—"} · {when(saved.warning)}</div></div>}
        {!saved.blacklist?.remark && !saved.warning?.remark &&
          <div style={{ color: "var(--mut)", fontSize: 14, marginTop: 6 }}>None.</div>}
      </>)}
      {editing && (<div style={{ marginTop: 10, display: "grid", gap: 12 }}>
        <div>
          <label className="f">Warning remark <span style={{ color: "var(--mut)", textTransform: "none", letterSpacing: 0 }}>
            — pops up whenever this customer is opened, paid or pledged, at every branch</span></label>
          <textarea className="i" rows={2} value={w} disabled={!mayWarn} maxLength={500}
            onChange={e => setW(e.target.value)} placeholder="e.g. Always confirm identity — a relative tried to redeem her gold in June" />
        </div>
        <div>
          <label className="f">Blacklist remark <span style={{ color: "var(--mut)", textTransform: "none", letterSpacing: 0 }}>
            — blocks every new loan and pops up on search; clear it to lift the blacklist</span></label>
          <textarea className="i" rows={2} value={b} disabled={!mayBlacklist} maxLength={500}
            onChange={e => setB(e.target.value)} placeholder={mayBlacklist ? "e.g. Pledged spurious gold at B1 on 03-09-2026" : "needs the Blacklist permission"} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn green" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save remarks"}</button>
          <button type="button" className="btn ghost" disabled={busy}
            onClick={() => { setEditing(false); setW(saved.warning?.remark || ""); setB(saved.blacklist?.remark || ""); }}>Cancel</button>
          {msg && <span className={"chip " + (msg.bad ? "bad" : "ok")}>{msg.text}</span>}
        </div>
      </div>)}
    </div>
  );
}
