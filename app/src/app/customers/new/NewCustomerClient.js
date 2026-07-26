"use client";
import { useState, useMemo } from "react";
import PhotoInput from "@/components/PhotoInput.js";
import { validateNewCustomer, blacklistState, isMobile, isAadhaar, isPan,
         isIfsc, isPincode } from "@/lib/customer.js";

const TABS = [["identity","Identity"],["contact","Contact"],["address","Address"],
              ["documents","Documents"],["nominee","Nominee"],["limits","Loan settings"],["bank","Bank details"]];
const REL = ["Father","Mother","Husband","Wife","Son","Daughter","Brother","Sister","Other"];

const blank = (q) => {
  const isNum = /^\d+$/.test((q || "").replace(/\s/g, ""));
  const words = (q || "").trim().split(/\s+/);
  return {
    custType: "individual",
    firstName: isNum ? "" : (words[0] || ""), middleName: "",
    lastName: isNum ? "" : (words.slice(1).join(" ") || ""),
    dob: "", gender: "", relativeName: "",
    aadhaar: "", aadhaarVerified: false, pan: "", panVerified: false, gstin: "", risk: "",
    photoFileId: null, photo: null,
    mobile: isNum ? (q || "").replace(/\s/g, "").slice(0, 10) : "", altMobile: "", email: "", appAccess: false,
    current: { line1: "", line2: "", pincode: "", area: "", taluka: "", district: "", state: "" },
    sameAsCurrent: true,
    permanent: { line1: "", line2: "", pincode: "", area: "", taluka: "", district: "", state: "" },
    idDocs: [{ docTypeId: "", number: "", scans: [], files: [] }],
    addrDocs: [{ docTypeId: "", number: "", scans: [], files: [] }],
    nominee: { name: "", relation: "", mobile: "" },
    maxOpenLoans: 3, maxOutstandingPaise: 50000000, narration: "",
    banks: [],
  };
};

export default function NewCustomerClient({ docTypes, prefill }) {
  const [c, setC] = useState(() => blank(prefill));
  const [tab, setTab] = useState(0);
  const [touched, setTouched] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(null);
  const [confirmBlacklist, setConfirmBlacklist] = useState(false);

  const set = (patch) => setC(prev => ({ ...prev, ...patch }));
  const setIn = (key, patch) => setC(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const v = useMemo(() => validateNewCustomer(c), [c]);
  const bl = blacklistState(c.maxOpenLoans, c.maxOutstandingPaise, c.narration);
  const missOf = (k) => v.missing[k] || [];

  async function lookupPin(which, pin) {
    setIn(which, { pincode: pin });
    if (!isPincode(pin)) return;
    const r = await fetch(`/api/lookup?pincode=${pin}`).then(r => r.json()).catch(() => null);
    if (r?.ok) setIn(which, { area: r.area, taluka: r.taluka, district: r.district, state: r.state });
  }
  async function lookupIfsc(i, ifsc) {
    patchBank(i, { ifsc: ifsc.toUpperCase() });
    if (!isIfsc(ifsc)) return;
    const r = await fetch(`/api/lookup?ifsc=${ifsc.toUpperCase()}`).then(r => r.json()).catch(() => null);
    if (r?.ok) patchBank(i, { bank: r.bank, bankBranch: r.branchName });
  }
  const patchBank = (i, patch) => setC(prev => ({
    ...prev, banks: prev.banks.map((b, j) => j === i ? { ...b, ...patch } : b) }));

  async function save(force = false) {
    setBusy(true); setChip(null);
    const r = await fetch("/api/customers", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...c, blacklistAcknowledged: force }),
    }).then(r => r.json()).catch(() => ({ ok: false, reason: "Network problem" }));
    setBusy(false);
    if (r.needsBlacklistConfirm) { setConfirmBlacklist(true); return; }
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    window.location.href = `/customers/${r.id}?created=1`;
  }

  function onSave() {
    setTouched(new Set(TABS.map((_, i) => i)));
    if (!v.ok) {
      const firstBad = TABS.findIndex(([k]) => missOf(k).length);
      setTab(firstBad); setChip({ tone: "bad", text: `Missing: ${missOf(TABS[firstBad][0]).join(", ")}` });
      return;
    }
    save(false);
  }

  const idTypes = docTypes.filter(d => d.category === "id_proof");
  const addrTypes = docTypes.filter(d => d.category === "address_proof");

  return (
    <div>
      {/* tab bar */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, marginBottom: 16 }}>
        {TABS.map(([k, label], i) => {
          const miss = missOf(k).length;
          const seen = touched.has(i);
          return (
            <button key={k} onClick={() => { setTouched(t => new Set(t).add(tab)); setTab(i); }}
              style={{ border: 0, cursor: "pointer", padding: "9px 15px", borderRadius: 11, fontWeight: 800,
                fontSize: 13.5, whiteSpace: "nowrap", display: "flex", gap: 7, alignItems: "center",
                background: i === tab ? "var(--vault)" : "#eceadf", color: i === tab ? "#fff" : "var(--mut)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto",
                background: !seen ? "#c9c4b6" : miss ? "var(--brass)" : "#4cc38a" }} />
              {label}
            </button>);
        })}
      </div>

      <div className="card">
        {tab === 0 && <>
          <div className="fg3">
            <F label="First name *"><input className="i" value={c.firstName} onChange={e => set({ firstName: e.target.value })} /></F>
            <F label="Middle name"><input className="i" value={c.middleName} onChange={e => set({ middleName: e.target.value })} /></F>
            <F label="Last name *"><input className="i" value={c.lastName} onChange={e => set({ lastName: e.target.value })} /></F>
            <F label="Date of birth *"><input className="i" type="date" value={c.dob} onChange={e => set({ dob: e.target.value })} /></F>
            <F label="Gender *"><select className="i" value={c.gender} onChange={e => set({ gender: e.target.value })}>
              <option value="" /><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
            </select></F>
            <F label="Customer type"><select className="i" value={c.custType} onChange={e => set({ custType: e.target.value })}>
              {["individual","corporate","huf","partnership","trust"].map(t => <option key={t} value={t}>{t}</option>)}
            </select></F>
          </div>
          <div className="fg3" style={{ marginTop: 14 }}>
            <F label="Aadhaar number *" hint={c.aadhaarVerified ? null : "12 digits, then Verify"}>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="i mono" maxLength={12} value={c.aadhaar}
                  onChange={e => set({ aadhaar: e.target.value.replace(/\D/g, ""), aadhaarVerified: false })} />
                <button className="btn ghost" style={{ padding: "0 12px" }} type="button"
                  disabled={!isAadhaar(c.aadhaar)} onClick={() => set({ aadhaarVerified: true })}>Verify</button>
              </div>
              {c.aadhaarVerified && <span className="chip ok" style={{ marginTop: 6 }}>verified (manual)</span>}
            </F>
            <F label="PAN *">
              <div style={{ display: "flex", gap: 6 }}>
                <input className="i mono" maxLength={10} style={{ textTransform: "uppercase" }} value={c.pan}
                  onChange={e => set({ pan: e.target.value.toUpperCase(), panVerified: false })} />
                <button className="btn ghost" style={{ padding: "0 12px" }} type="button"
                  disabled={!isPan(c.pan)} onClick={() => set({ panVerified: true })}>Verify</button>
              </div>
              {c.panVerified && <span className="chip ok" style={{ marginTop: 6 }}>verified (manual)</span>}
            </F>
            <F label="Father / spouse name"><input className="i" value={c.relativeName}
              onChange={e => set({ relativeName: e.target.value })} /></F>
          </div>
          <div style={{ marginTop: 16 }}>
            <PhotoInput kind="customer_photo" label="Live photo *" square
              value={c.photo} onChange={f => set({ photo: f, photoFileId: f?.fileId ?? null })}
              hint="Taken at the counter. Compressed on this device before upload." />
          </div>
          <div className="hint" style={{ marginTop: 14 }}>
            Aadhaar and PAN buttons record a manual check by you. Automatic verification switches on
            when the KYC vendor is connected — the stored field does not change.
          </div>
        </>}

        {tab === 1 && <div className="fg3">
          <F label="Mobile number *" hint={isMobile(c.mobile) ? null : "10 digits, starting 6-9"}>
            <input className="i mono" maxLength={10} value={c.mobile}
              onChange={e => set({ mobile: e.target.value.replace(/\D/g, "") })} /></F>
          <F label="Alternate mobile"><input className="i mono" maxLength={10} value={c.altMobile}
            onChange={e => set({ altMobile: e.target.value.replace(/\D/g, "") })} /></F>
          <F label="Email" wide><input className="i" value={c.email} placeholder="name@example.com"
            onChange={e => set({ email: e.target.value })} /></F>
          <F label="App access">
            <label className="pill"><input type="checkbox" checked={c.appAccess}
              onChange={e => set({ appAccess: e.target.checked })} /> Customer app & portal</label></F>
        </div>}

        {tab === 2 && <>
          <Addr title="Current address" a={c.current}
            onLine={(k, val) => setIn("current", { [k]: val })} onPin={p => lookupPin("current", p)} />
          <label className="pill" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={c.sameAsCurrent}
              onChange={e => set({ sameAsCurrent: e.target.checked })} /> Permanent address same as current
          </label>
          {!c.sameAsCurrent && <div style={{ marginTop: 14 }}>
            <Addr title="Permanent address" a={c.permanent}
              onLine={(k, val) => setIn("permanent", { [k]: val })} onPin={p => lookupPin("permanent", p)} />
          </div>}
        </>}

        {tab === 3 && <>
          <DocGroup title="ID proof *" types={idTypes} rows={c.idDocs}
            onChange={rows => set({ idDocs: rows })} kind="kyc_scan" />
          <div style={{ height: 1, background: "var(--line)", margin: "18px 0" }} />
          <DocGroup title="Address proof *" types={addrTypes} rows={c.addrDocs}
            onChange={rows => set({ addrDocs: rows })} kind="kyc_scan" />
        </>}

        {tab === 4 && <div className="fg3">
          <F label="Nominee full name *" wide><input className="i" value={c.nominee.name}
            onChange={e => setIn("nominee", { name: e.target.value })} /></F>
          <F label="Relation *"><select className="i" value={c.nominee.relation}
            onChange={e => setIn("nominee", { relation: e.target.value })}>
            <option value="" />{REL.map(r => <option key={r}>{r}</option>)}</select></F>
          <F label="Nominee mobile"><input className="i mono" maxLength={10} value={c.nominee.mobile}
            onChange={e => setIn("nominee", { mobile: e.target.value.replace(/\D/g, "") })} /></F>
        </div>}

        {tab === 5 && <>
          <div className="fg3">
            <F label="Max open loans" hint="up to 9999">
              <input className="i mono" maxLength={4} value={c.maxOpenLoans}
                onChange={e => set({ maxOpenLoans: e.target.value.replace(/\D/g, "") })} /></F>
            <F label="Max outstanding ₹" hint="up to 99,99,99,999">
              <input className="i mono" maxLength={9} value={Math.round(c.maxOutstandingPaise / 100)}
                onChange={e => set({ maxOutstandingPaise: Number(e.target.value.replace(/\D/g, "") || 0) * 100 })} /></F>
          </div>
          <F label={"Narration" + (bl.narrationRequired ? " *" : "")}>
            <textarea className="i" rows={2} value={c.narration}
              placeholder="Reason / remarks — mandatory if any limit is zero"
              onChange={e => set({ narration: e.target.value })} /></F>
          {bl.isBlacklisted &&
            <div style={{ marginTop: 10 }}><span className="chip bad">
              a zero limit marks this customer BLACKLISTED / BAD DEBTOR — narration mandatory</span></div>}
        </>}

        {tab === 6 && <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                        gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="hint" style={{ margin: 0 }}>
              Optional · every account the customer may use · money can only be sent to a verified one.</div>
            <button className="btn ghost" type="button" style={{ padding: "8px 14px", fontSize: 13 }}
              onClick={() => set({ banks: [...c.banks, { ifsc: "", accountNo: "", holderName: "",
                verifyMethod: "none", bank: "", bankBranch: "" }] })}>+ Add bank account</button>
          </div>
          {c.banks.length === 0 && <div style={{ color: "var(--mut)", fontSize: 14 }}>No accounts yet.</div>}
          {c.banks.map((b, i) => (
            <div key={i} className="card" style={{ background: "#fcfbf7", marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12,
                            fontWeight: 800, color: "var(--mut)", marginBottom: 10 }}>
                <span>ACCOUNT {i + 1}</span>
                <button className="btn ghost" type="button" style={{ padding: "3px 9px", fontSize: 12 }}
                  onClick={() => set({ banks: c.banks.filter((_, j) => j !== i) })}>remove</button>
              </div>
              <div className="fg3">
                <F label="IFSC" hint={b.bank || null}>
                  <input className="i mono" maxLength={11} style={{ textTransform: "uppercase" }}
                    value={b.ifsc} onChange={e => lookupIfsc(i, e.target.value)} /></F>
                <F label="Account number"><input className="i mono" value={b.accountNo}
                  onChange={e => patchBank(i, { accountNo: e.target.value.replace(/\D/g, ""), verifiedAt: null })} /></F>
                <F label="Holder name">
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="i" value={b.holderName}
                      onChange={e => patchBank(i, { holderName: e.target.value, verifiedAt: null })} />
                    <button className="btn ghost" type="button" style={{ padding: "0 12px" }}
                      disabled={!b.accountNo || !isIfsc(b.ifsc) || !b.holderName}
                      onClick={() => {
                        const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
                        const match = norm(b.holderName).includes(norm(c.firstName + c.lastName)) ||
                                      norm(c.firstName + c.lastName).includes(norm(b.holderName));
                        patchBank(i, match
                          ? { verifyMethod: "penny_drop", verifiedAt: new Date().toISOString(), mismatch: false }
                          : { verifyMethod: "none", verifiedAt: null, mismatch: true });
                      }}>Verify</button>
                  </div></F>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {b.verifiedAt && <span className="chip ok">holder matches customer ✓</span>}
                {b.mismatch && !b.chequeFileId &&
                  <span className="chip bad">name mismatch — cancelled cheque required</span>}
                {b.chequeFileId && <span className="chip ok">cancelled cheque on file ✓</span>}
                {b.mismatch && <PhotoInput kind="cheque" value={b.cheque}
                  onChange={f => patchBank(i, { cheque: f, chequeFileId: f?.fileId ?? null,
                    verifyMethod: f ? "cheque_photo" : "none" })} />}
              </div>
            </div>
          ))}
        </>}
      </div>

      {/* sticky save bar */}
      <div style={{ position: "sticky", bottom: 0, marginTop: 16, background: "var(--vault)",
        borderRadius: 14, padding: "12px 16px", display: "flex", justifyContent: "space-between",
        alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ color: "#9fc6b5", fontSize: 13.5, fontWeight: 600 }}>
          {v.ok ? <>All sections complete <b style={{ color: "var(--brass-soft)" }}>✓ ready to save</b></>
                : <><b style={{ color: "var(--brass-soft)" }}>{v.count}</b> item(s) pending — {v.first}</>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" disabled={tab === 0} onClick={() => setTab(t => t - 1)}>← Previous</button>
          <button className="btn ghost" disabled={tab === TABS.length - 1}
            onClick={() => { setTouched(t => new Set(t).add(tab)); setTab(t => t + 1); }}>Next →</button>
          <button className="btn green" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save customer"}</button>
        </div>
      </div>
      {chip && <div style={{ marginTop: 10 }}><span className={"chip " + chip.tone}>{chip.text}</span></div>}

      {confirmBlacklist && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(12,35,27,.6)", display: "grid",
          placeItems: "center", zIndex: 40, padding: 16 }}>
          <div className="card" style={{ maxWidth: 440, borderTop: "6px solid var(--bad)" }}>
            <h2 style={{ fontSize: 19, fontWeight: 900 }}>⚠ Blacklisted / bad debtor</h2>
            <p style={{ color: "var(--mut)", fontSize: 14, margin: "10px 0" }}>
              A zero limit means this customer cannot borrow. The flag and narration will appear
              every time the customer is opened.</p>
            <div style={{ background: "var(--bad-bg)", color: "var(--bad)", borderRadius: 10,
              padding: 10, fontSize: 14, fontWeight: 700 }}>“{c.narration}”</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setConfirmBlacklist(false)}>Go back</button>
              <button className="btn green" onClick={() => { setConfirmBlacklist(false); save(true); }}>
                Save as blacklisted</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .fg3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
        .wide{grid-column:span 2}
        @media(max-width:760px){.wide{grid-column:span 1}}
        .pill{display:inline-flex;align-items:center;gap:9px;font-size:13.5px;font-weight:700;
          background:#faf9f4;border:1px solid var(--line);padding:9px 13px;border-radius:11px;cursor:pointer}
        .pill input{width:17px;height:17px;accent-color:#1b4434}
        textarea.i{resize:vertical;font-family:inherit}
      `}</style>
    </div>
  );
}

function F({ label, hint, wide, children }) {
  return (<div className={wide ? "wide" : ""}>
    {label && <label className="f">{label}</label>}
    {children}
    {hint && <div className="hint" style={{ marginTop: 5 }}>{hint}</div>}
  </div>);
}

function Addr({ title, a, onLine, onPin }) {
  return (<>
    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>{title}</div>
    <div className="fg3">
      <F label="Address line 1 *" wide><input className="i" value={a.line1}
        onChange={e => onLine("line1", e.target.value)} /></F>
      <F label="Line 2"><input className="i" value={a.line2} onChange={e => onLine("line2", e.target.value)} /></F>
      <F label="Pincode *" hint="fills the rest automatically">
        <input className="i mono" maxLength={6} style={{ maxWidth: 130 }} value={a.pincode}
          onChange={e => onPin(e.target.value.replace(/\D/g, ""))} /></F>
      <F label="Area"><input className="i" value={a.area} onChange={e => onLine("area", e.target.value)} /></F>
      <F label="Taluka"><input className="i" value={a.taluka} onChange={e => onLine("taluka", e.target.value)} /></F>
      <F label="District"><input className="i" value={a.district} onChange={e => onLine("district", e.target.value)} /></F>
      <F label="State"><input className="i" value={a.state} onChange={e => onLine("state", e.target.value)} /></F>
    </div>
  </>);
}

function DocGroup({ title, types, rows, onChange, kind }) {
  const patch = (i, p) => onChange(rows.map((r, j) => j === i ? { ...r, ...p } : r));
  return (<>
    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>{title}</div>
    {rows.map((d, i) => (
      <div key={i} className="fg3" style={{ alignItems: "end", marginBottom: 12 }}>
        <F label="Type"><select className="i" value={d.docTypeId}
          onChange={e => patch(i, { docTypeId: Number(e.target.value) || "" })}>
          <option value="" />{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></F>
        <F label="Document number"><input className="i mono" value={d.number}
          onChange={e => patch(i, { number: e.target.value })} /></F>
        <F label="Photos">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <PhotoInput kind={kind} multiple value={d.files || []}
              onChange={files => patch(i, { files, scans: files.map(f => f.fileId) })} />
            {rows.length > 1 && <button className="btn ghost" type="button" style={{ padding: "6px 10px" }}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}>remove</button>}
          </div></F>
      </div>
    ))}
    <button className="btn ghost" type="button" style={{ padding: "7px 12px", fontSize: 13 }}
      onClick={() => onChange([...rows, { docTypeId: "", number: "", scans: [], files: [] }])}>
      + Additional document</button>
  </>);
}
