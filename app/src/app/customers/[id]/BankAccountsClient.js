"use client";
import { useState } from "react";
import PhotoInput from "@/components/PhotoInput.js";

const F = { display: "block", fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
  textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 };
const I = { width: "100%", border: "1px solid #cfc9ba", borderRadius: 10, padding: "0 11px",
  height: 40, fontSize: 13.5, background: "#fff", boxSizing: "border-box" };
const BLANK = { bank: "", bankBranch: "", accountNo: "", ifsc: "", holderName: "", acctType: "", chequeFileId: null };

export default function BankAccountsClient({ customerId, accounts, mayEdit }) {
  const [form, setForm] = useState(null);   // BLANK + {id?} + orig for reset warning
  const [view, setView] = useState(null);   // E19 №2 (owner, 29 Aug 2026): read-only account panel
  const [busy, setBusy] = useState(false);
  const [confirmVerify, setConfirmVerify] = useState(null);
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
                marginLeft: 8, fontSize: 12 }}>{String(a.accountNo)} · {a.ifsc}</span></div>
            <div style={{ fontSize: 12, color: "var(--mut)" }}>{a.holderName}</div>
          </div>
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexShrink: 0 }}>
            <span className={"chip " + (a.verifiedAt ? "ok" : "warn")}
              title={a.verifiedAt ? "verified — payouts allowed" : "unverified — no payouts until verified"}>
              {a.verifiedAt ? "verified" : "unverified"}</span>
            <button className="btn ghost" style={{ padding: "5px 11px", fontSize: 12 }}
              onClick={() => { setView(a); setConfirmVerify(null); }}>View</button>
            {mayEdit &&
              <button className="btn ghost" style={{ padding: "5px 11px", fontSize: 12 }}
                onClick={() => setForm({ ...BLANK, id: a.id, bank: a.bank,
                  bankBranch: a.bankBranch || "", accountNo: String(a.accountNo),
                  ifsc: a.ifsc, holderName: a.holderName, acctType: a.acctType || "",
                  chequeFileId: a.chequeFileId || null,
                  _proofs: a.proofs || [], _verifiedAt: a.verifiedAt || null,
                  _origAcct: String(a.accountNo), _origIfsc: a.ifsc })}>Edit</button>}
          </div>
        </div>
      ))}
      {view && (
        <div style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 12,
          padding: "14px 16px", background: "#fbfaf5" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
              textTransform: "uppercase", color: "var(--mut)" }}>Bank account — details</div>
            <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={() => setView(null)}>✕ Close</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            gap: 12, marginTop: 10, fontSize: 13.5 }}>
            <div><b>Bank</b><br />{view.bank}{view.bankBranch ? ` · ${view.bankBranch}` : ""}</div>
            <div><b>Account</b><br /><span className="mono">{String(view.accountNo)}</span></div>
            <div><b>IFSC</b><br /><span className="mono">{view.ifsc}</span></div>
            <div><b>Holder</b><br />{view.holderName}{view.acctType ? ` · ${view.acctType}` : ""}</div>
            <div><b>Status</b><br />
              <span className={"chip " + (view.verifiedAt ? "ok" : "warn")}>
                {view.verifiedAt ? "verified" : "unverified — no payouts"}</span></div>
          </div>
          {/* E20 №4: VIEW is view-only — the gallery, nothing touchable */}
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
            {(view.proofs || []).length === 0 &&
              <span style={{ fontSize: 13, color: "var(--mut)" }}>No cheque / passbook photo yet.</span>}
            {(view.proofs || []).map(pr => (
              <a key={pr.id} href={pr.full || pr.thumb} target="_blank" rel="noreferrer"
                title={"Uploaded " + pr.addedAt + " — open full size"}>
                <img src={pr.thumb} alt="proof" style={{ width: 84, height: 84,
                  objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)",
                  display: "block" }} />
                <div style={{ fontSize: 10.5, color: "var(--mut)", textAlign: "center",
                  marginTop: 2 }}>{pr.addedAt}</div></a>))}
          </div>
        </div>)}

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
          {/* №6 (owner 28 Aug 2026): proof photo — cancelled cheque or passbook front page */}
          <div style={{ marginTop: 12 }}>
            {/* E20 №4: the gallery works here — view, delete (soft), add, verify */}
            {form.id && (form._proofs || []).map(pr => (
              <span key={pr.id} style={{ position: "relative", display: "inline-block",
                marginRight: 8, verticalAlign: "middle" }}>
                <a href={pr.full || pr.thumb} target="_blank" rel="noreferrer"
                  title={"Uploaded " + pr.addedAt + " — open full size"}>
                  <img src={pr.thumb} alt="proof" style={{ width: 44, height: 44,
                    objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)",
                    display: "block" }} /></a>
                <button type="button" title="Remove this photo (kept in the audit trail)"
                  onClick={async () => {
                    if (!window.confirm("Remove this photo? It stays in the audit trail.")) return;
                    const r = await fetch(`/api/customers/${customerId}/banks`, {
                      method: "POST", headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "proof_remove", proofId: pr.id }),
                    }).then(x => x.json()).catch(() => ({ ok: false }));
                    if (r.ok) window.location.reload();
                  }}
                  style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20,
                    borderRadius: "50%", border: 0, background: "var(--bad)", color: "#fff",
                    cursor: "pointer", fontSize: 12, fontWeight: 900, lineHeight: 1 }}>×</button>
              </span>))}
            {form.id && (
              <PhotoInput kind="cheque" compact label="Add photo" value={null}
                onChange={async (fid) => {
                  if (!fid) return;
                  const r = await fetch(`/api/customers/${customerId}/banks`, {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ action: "proof", id: form.id, chequeFileId: fid }),
                  }).then(x => x.json()).catch(() => ({ ok: false }));
                  if (r.ok) window.location.reload();
                }} />)}
            {form.id && !form._verifiedAt && (
              confirmVerify === "form" + form.id
                ? <button type="button" className="btn green" style={{ padding: "6px 11px",
                    fontSize: 12, marginLeft: 8 }} disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      const r = await fetch(`/api/customers/${customerId}/banks`, {
                        method: "POST", headers: { "content-type": "application/json" },
                        body: JSON.stringify({ action: "verify", id: form.id }),
                      }).then(x => x.json()).catch(() => null);
                      setBusy(false); setConfirmVerify(null);
                      if (r?.ok) window.location.reload();
                    }}>Proof seen — confirm verify</button>
                : <button type="button" className="btn ghost" style={{ padding: "6px 11px",
                    fontSize: 12, marginLeft: 8 }} disabled={busy}
                    onClick={() => setConfirmVerify("form" + form.id)}
                    title="Mark verified after seeing the passbook or a cancelled cheque">
                    Mark verified</button>)}
            {!form.id && <PhotoInput kind="cheque" compact
              label="Cancelled cheque / passbook photo"
              hint="Take or upload one photo — it stays attached to this account and backs the verification"
              value={form.chequeFileId}
              onChange={(id) => setForm({ ...form, chequeFileId: id })} />}
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
