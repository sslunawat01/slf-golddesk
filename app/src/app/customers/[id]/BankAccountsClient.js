"use client";
import { useState } from "react";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 40, fontSize: 13.5, background: "#fff", boxSizing: "border-box" };
const BLANK = { bank: "", bankBranch: "", accountNo: "", ifsc: "", holderName: "", acctType: "" };

export default function BankAccountsClient({ customerId, accounts, mayEdit }) {
  const [form, setForm] = useState(null);   // BLANK + {id?} + orig for reset warning
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(null);

  async function onIfsc(v) {
    const ifsc = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
    setForm({ ...form, ifsc });
    if (ifsc.length === 11) {
      const r = await fetch(`/api/lookup?ifsc=${ifsc}`).then(x => x.json()).catch(() => null);
      if (r?.ok && r.bank)
        setForm(f => ({ ...f, ifsc, bank: r.bank, bankBranch: r.branch || f.bankBranch }));
    }
  }

  async function save() {
    setBusy(true); setChip(null);
    const r = await fetch(`/api/customers/${customerId}/banks`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form.id ? { action: "edit", ...form } : form) })
      .then(x => x.json()).catch(() => ({ ok: false, reason: "Cannot reach the server" }));
    setBusy(false);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    window.location.reload();
  }

  const identityChanged = form?.id &&
    (form.accountNo !== form._origAcct || form.ifsc !== form._origIfsc);

  return (
    <div>
      {accounts.map(a => (
        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10,
          alignItems: "center", padding: "8px 0", borderBottom: "1px dashed var(--line)",
          flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.bank}
              <span className="mono" style={{ color: "var(--mut)", fontWeight: 600,
                marginLeft: 8, fontSize: 12 }}>····{String(a.accountNo).slice(-4)} · {a.ifsc}</span></div>
            <div style={{ fontSize: 12, color: "var(--mut)" }}>{a.holderName}</div>
          </div>
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexShrink: 0 }}>
            <span className={"chip " + (a.verifiedAt ? "ok" : "warn")}>
              {a.verifiedAt ? "verified" : "not verified — no payouts"}</span>
            {mayEdit &&
              <button className="btn ghost" style={{ padding: "5px 11px", fontSize: 12 }}
                onClick={() => setForm({ ...BLANK, id: a.id, bank: a.bank,
                  bankBranch: a.bankBranch || "", accountNo: String(a.accountNo),
                  ifsc: a.ifsc, holderName: a.holderName, acctType: a.acctType || "",
                  _origAcct: String(a.accountNo), _origIfsc: a.ifsc })}>Edit</button>}
          </div>
        </div>
      ))}
      {accounts.length === 0 &&
        <div style={{ color: "var(--mut)", fontSize: 13.5, padding: "4px 0" }}>
          No bank account on file — cash payouts only.</div>}

      {form && (
        <div style={{ border: "1px dashed #cfc9ba", borderRadius: 12, padding: 14, marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
            gap: 10 }}>
            <div><span style={F}>Account number *</span>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} inputMode="numeric"
                value={form.accountNo}
                onChange={e => setForm({ ...form,
                  accountNo: e.target.value.replace(/\D/g, "").slice(0, 20) })} /></div>
            <div><span style={F}>IFSC * — fills the bank</span>
              <input style={{ ...I, fontFamily: "ui-monospace,monospace" }} value={form.ifsc}
                onChange={e => onIfsc(e.target.value)} placeholder="SBIN0001234" /></div>
            <div><span style={F}>Bank</span>
              <input style={I} value={form.bank}
                onChange={e => setForm({ ...form, bank: e.target.value })} /></div>
            <div><span style={F}>Account holder *</span>
              <input style={I} value={form.holderName}
                onChange={e => setForm({ ...form, holderName: e.target.value })} /></div>
          </div>
          {identityChanged && (
            <div style={{ marginTop: 10 }}>
              <span className="chip warn">
                Changing the number or IFSC clears verification — payouts to this account will
                refuse until it is verified again</span></div>)}
          {chip && <div style={{ marginTop: 10 }}>
            <span className={"chip " + chip.tone}>{chip.text}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
            <button className="btn ghost" onClick={() => { setForm(null); setChip(null); }}>Cancel</button>
            <button className="btn" disabled={busy || !form.accountNo || form.ifsc.length !== 11
                || form.holderName.trim().length < 3}
              onClick={save}>{busy ? "Saving…" : form.id ? "Save account" : "Add account"}</button>
          </div>
        </div>
      )}

      {mayEdit && !form && (
        <button className="btn ghost" style={{ marginTop: 8, padding: "6px 12px", fontSize: 12.5 }}
          onClick={() => { setForm({ ...BLANK }); setChip(null); }}>+ Add bank account</button>)}
    </div>
  );
}
