"use client";
import { useEffect, useState } from "react";
import SavedToast from "@/app/ui/SavedToast.js";
import { deactivationNote } from "@/lib/slfbanks.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 40, fontSize: 13.5, background: "#fff", boxSizing: "border-box" };
const BLANK = { nickname: "", bank: "", ifsc: "", accountNo: "", branchIds: [], scopeAll: true,
  ledgerId: 0, allowDisbursement: true, allowCollection: true };

export default function BanksTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(0);   // №4: flashes the shared Saved banner
  const [form, setForm] = useState(null);

  const load = () => fetch("/api/settings/banks").then(r => r.json())
    .then(r => r.ok ? setData(r) : setErr(r.reason))
    .catch(() => setErr("Could not load bank accounts"));
  useEffect(() => { load(); }, []);

  if (err && !data) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!data) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  async function post(body) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/settings/banks", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(r => r.json()).catch(() => ({ ok: false, reason: "Could not save" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return null; }
    setSavedAt(Date.now());   // №4: every successful save announces itself
    return r;
  }

  async function onIfsc(v) {
    const ifsc = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
    setForm({ ...form, ifsc });
    if (ifsc.length === 11) {
      const r = await fetch(`/api/lookup?ifsc=${ifsc}`).then(x => x.json()).catch(() => null);
      if (r?.ok && r.bank) setForm(f => ({ ...f, ifsc, bank: r.bank }));
    }
  }

  const td = { padding: "10px 12px", borderBottom: "1px solid #efece3", fontSize: 13 };
  const tick = (on) => ({ display: "inline-flex", alignItems: "center", gap: 6,
    border: "1px solid " + (on ? "var(--vault)" : "#cfc9ba"),
    background: on ? "var(--vault)" : "#fff", color: on ? "#fff" : "var(--mut)",
    borderRadius: 9, padding: "8px 12px", fontWeight: 800, fontSize: 12.5, cursor: "pointer" });

  return (
    <>
      <SavedToast when={savedAt} />
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em",
        textTransform: "uppercase", color: "var(--mut)", marginBottom: 8 }}>
        Company bank accounts — where disbursements leave from and collections land</div>

      {data.canEdit && !form && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button className="btn" onClick={() => setForm({ ...BLANK })}>+ Add account</button>
        </div>)}

      {err && <div style={{ marginBottom: 10 }}><span className="chip bad">{err}</span></div>}

      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead><tr style={{ background: "#f0eee6" }}>
            {["Nickname", "Bank · IFSC", "Account", "Scope", "Used for", "Status"].map((h, i) =>
              <th key={h} style={{ ...td, fontSize: 10.5, letterSpacing: ".07em",
                textTransform: "uppercase", textAlign: i === 5 ? "right" : "left" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.rows.map(a => (
              <tr key={a.id} style={{ opacity: a.active ? 1 : .5 }}>
                <td style={{ ...td, fontWeight: 800 }}>{a.nickname}</td>
                <td style={td}>{a.bank}
                  <span className="mono" style={{ color: "var(--mut)", fontSize: 11.5,
                    marginLeft: 6 }}>{a.ifsc}</span></td>
                <td style={{ ...td, fontFamily: "ui-monospace,monospace", fontSize: 12.5 }}>
                  {a.accountNo}</td>
                <td style={{ ...td, color: "var(--mut)", fontSize: 12.5 }}>{a.branchLabel}</td>
                <td style={td}>
                  {a.allowDisbursement && <span className="chip mut" style={{ marginRight: 4 }}>disburse</span>}
                  {a.allowCollection && <span className="chip mut">collect</span>}
                </td>
                <td style={td}>
                  <div style={{ display: "flex", gap: 7, justifyContent: "flex-end",
                    alignItems: "center", flexWrap: "wrap" }}>
                    {a.usedOn > 0 && <span className="chip mut">{a.usedOn} payments</span>}
                    <span className={"chip " + (a.active ? "ok" : "mut")}>
                      {a.active ? "active" : "off"}</span>
                    {data.canEdit && <>
                      <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
                        disabled={busy} title={deactivationNote(a.usedOn)}
                        onClick={async () => { const r = await post({ action: "toggle", id: a.id });
                          if (r) load(); }}>{a.active ? "Switch off" : "Switch on"}</button>
                      <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
                        onClick={() => setForm({ ...BLANK, id: a.id, nickname: a.nickname,
                          bank: a.bank, ifsc: a.ifsc, accountNo: a.accountNo,
                          branchIds: [...(a.branchIds || [])], scopeAll: a.scopeAll !== false,
                          ledgerId: a.ledgerId || 0, allowDisbursement: a.allowDisbursement,
                          allowCollection: a.allowCollection })}>Edit</button>
                    </>}
                  </div>
                </td>
              </tr>))}
            {data.rows.length === 0 &&
              <tr><td colSpan={6} style={{ ...td, color: "var(--mut)" }}>
                No company accounts yet — bank-mode disbursement stays hidden until one exists.</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="card" style={{ border: "1px dashed #cfc9ba", marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 12 }}>
            {form.id ? "Edit account — " + form.nickname : "New company bank account"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 12 }}>
            <div><span style={F}>Nickname * — how staff know it</span>
              <input style={I} value={form.nickname} placeholder="HDFC current — HO"
                onChange={e => setForm({ ...form, nickname: e.target.value })} /></div>
            <div><span style={F}>IFSC * — fills the bank</span>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} value={form.ifsc}
                placeholder="HDFC0001234" onChange={e => onIfsc(e.target.value)} /></div>
            <div><span style={F}>Bank *</span>
              <input style={I} value={form.bank}
                onChange={e => setForm({ ...form, bank: e.target.value })} /></div>
            <div><span style={F}>Account number * — 9–18 digits</span>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} inputMode="numeric"
                value={form.accountNo} placeholder="50100234567890"
                onChange={e => setForm({ ...form,
                  accountNo: e.target.value.replace(/\D/g, "").slice(0, 18) })} /></div>
            {data.ledgers.length > 0 &&
              <div><span style={F}>Ledger — optional</span>
                <select style={I} value={form.ledgerId}
                  onChange={e => setForm({ ...form, ledgerId: Number(e.target.value) })}>
                  <option value={0}>—</option>
                  {data.ledgers.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select></div>}
          </div>
          <div style={{ marginTop: 12 }}>
            <span style={F}>Available at</span>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <button style={tick(form.scopeAll)}
                onClick={() => setForm({ ...form, scopeAll: !form.scopeAll })}>
                {form.scopeAll ? "✓" : ""} All branches</button>
              {data.branches.map(b => {
                const on = !form.scopeAll && form.branchIds.includes(b.id);
                return (
                  <button key={b.id} style={{ ...tick(on), opacity: form.scopeAll ? .4 : 1 }}
                    disabled={form.scopeAll}
                    onClick={() => setForm({ ...form,
                      branchIds: on ? form.branchIds.filter(x => x !== b.id)
                                    : [...form.branchIds, b.id] })}>
                    {on ? "✓" : ""} {b.label}</button>);
              })}
            </div>
            {!form.scopeAll && form.branchIds.length === 0 &&
              <div className="hint" style={{ marginTop: 6 }}>
                No branch ticked — the account is parked: it will not appear in any
                disbursement or collection picker until a branch is ticked or
                All branches is switched back on.</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={tick(form.allowDisbursement)}
              onClick={() => setForm({ ...form, allowDisbursement: !form.allowDisbursement })}>
              {form.allowDisbursement ? "✓" : ""} Loan disbursement</button>
            <button style={tick(form.allowCollection)}
              onClick={() => setForm({ ...form, allowCollection: !form.allowCollection })}>
              {form.allowCollection ? "✓" : ""} Collections & receipts</button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            Expenses and internal transfers use these same accounts when those screens land —
            one master, every purpose.</div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn" disabled={busy || form.nickname.trim().length < 3
                || form.ifsc.length !== 11 || (!form.id && !form.accountNo)
                || (!form.allowDisbursement && !form.allowCollection)}
              onClick={async () => {
                const r = await post(form.id
                  ? { action: "edit", ...form }
                  : { action: "create", ...form });
                if (r) { setForm(null); load(); } }}>
              {busy ? "Saving…" : "Save account"}</button>
          </div>
        </div>
      )}

    </>
  );
}
