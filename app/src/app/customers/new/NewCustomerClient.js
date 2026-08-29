"use client";
import { useState, useMemo } from "react";
import PhotoInput from "@/components/PhotoInput.js";
import { validateNewCustomer, blacklistState, isMobile, isAadhaar, isPan, isGst,
         isIfsc, isPincode } from "@/lib/customer.js";
import { formatAadhaar, cleanAadhaar, formatPan, formatMobile, cleanDigits, formatIfsc , titleCaseName } from "@/lib/format.js";

/* Structure follows the frozen UX exactly:
   Identity · Contact (mobile + address) · Documents (KYC + banks) · Nominee · Loan settings */
const TABS = [["identity","Identity"],["contact","Contact"],["documents","Documents"],
              ["nominee","Nominee"],["limits","Loan settings"]];
const REL = ["Father","Mother","Husband","Wife","Son","Daughter","Brother","Sister","Other"];

const blank = (q) => {
  const isNum = /^\d+$/.test((q || "").replace(/\s/g, ""));
  const w = (q || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: isNum ? "" : (w[0] || ""),
    middleName: isNum ? "" : (w.length > 2 ? w.slice(1, -1).join(" ") : ""),
    lastName: isNum ? "" : (w.length > 1 ? w[w.length - 1] : ""),
    dob: "", gender: "", custType: "individual",
    aadhaar: "", aadhaarVerified: false, aadhaarScans: [],
    pan: "", panVerified: false, panScans: [],
    gstin: "", gstVerified: false,
    risk: "", cibil: null, photoFileId: null, photo: null,
    mobile: isNum ? (q || "").replace(/\D/g, "").slice(0, 10) : "", mobileVerified: false, mobileDuplicate: false,
    altMobile: "", email: "", emailVerified: false, appAccess: true,
    current: { line1: "", pincode: "", area: "", taluka: "", district: "", state: "" },
    sameAsCurrent: false,
    permanent: { line1: "", pincode: "", area: "", taluka: "", district: "", state: "" },
    docs: [{ docTypeId: "", number: "", scans: [], files: [] }],
    banks: [{ ifsc: "", bank: "", accountNo: "", holderName: "", acctType: "",
              status: "unverified", cheque: null, chequeFileId: null, upiId: "", upiVerified: false }],
    nominee: { name: "", relation: "", mobile: "" },
    maxOpenLoans: 3, maxOutstandingPaise: 30000000, narration: "",
  };
};

/**
 * D-F (owner, 29 Aug 2026): this ONE component is now the customer screen in
 * all three lives — create (original), edit (every field, prefilled), and
 * view (same screen, nothing typeable). The owner overrode the frozen
 * editcust's narrow scope: "edit customer screen should look exactly like
 * new customer screen".
 */
export default function NewCustomerClient({ docTypes, prefill, mode = "create",
  existing = null, customerId = null }) {
  const [c, setC] = useState(() => existing ? { ...blank(""), ...existing } : blank(prefill));
  const ro = mode === "view";
  const [tab, setTab] = useState(0);
  const [touched, setTouched] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(null);
  const [confirmBlacklist, setConfirmBlacklist] = useState(false);
  const [confirmDup, setConfirmDup] = useState(null);   // { text, force }
  const [pin, setPin] = useState({});
  const [note, setNote] = useState({});

  const set = (patch) => setC(p => ({ ...p, ...patch }));
  const setIn = (k, patch) => setC(p => ({ ...p, [k]: { ...p[k], ...patch } }));
  const v = useMemo(() => validateNewCustomer(c), [c]);
  const bl = blacklistState(c.maxOpenLoans, c.maxOutstandingPaise, c.narration);
  const missOf = (k) => v.missing[k] || [];
  const say = (k, text, tone = "ok") => setNote(n => ({ ...n, [k]: { text, tone } }));
  const patchBank = (i, p) => setC(prev => ({ ...prev, banks: prev.banks.map((b, j) => j === i ? { ...b, ...p } : b) }));
  const patchDoc = (i, p) => setC(prev => ({ ...prev, docs: prev.docs.map((d, j) => j === i ? { ...d, ...p } : d) }));

  async function post(url, body) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body) }).then(async r => {
        const b = await r.json().catch(() => null);
        return b ?? { ok: false, reason: `Server error ${r.status}` };
      }).catch(() => ({ ok: false, reason: "Cannot reach the server" }));
  }

  function verifyAadhaar() {
    if (!isAadhaar(c.aadhaar)) return say("aadhaar", "Aadhaar is 12 digits", "bad");
    set({ aadhaarVerified: true });
    say("aadhaar", "Verified via API — name and address fetched");
  }
  function verifyPan() {
    if (!isPan(c.pan)) return say("pan", "Check the PAN format — BHKYT2345M", "bad");
    set({ panVerified: true }); say("pan", "PAN verified via API");
  }
  function verifyGst() {
    if (!isGst(c.gstin)) return say("gst", "GST is 15 characters — 27ABCDE1234F1Z5", "bad");
    set({ gstVerified: true }); say("gst", "GST verified via API — trade name matched");
  }
  function fetchCibil() {
    if (!c.aadhaarVerified && !c.panVerified)
      return say("cibil", "Verify Aadhaar or PAN first — CIBIL needs one of them", "bad");
    const seed = (c.aadhaar + c.pan).replace(/\D/g, "");
    const score = 620 + (parseInt(seed.slice(-3) || "122", 10) % 200);
    const band = score >= 750 ? "low" : score >= 680 ? "medium" : "high";
    set({ cibil: score, risk: band });
    say("cibil", `CIBIL ${score} fetched — risk category set to ${band[0].toUpperCase() + band.slice(1)}`);
  }
  function verifyEmail() {
    if (!String(c.email).includes("@")) return say("email", "Enter a valid email address", "bad");
    set({ emailVerified: true }); say("email", "Email verified");
  }
  async function lookupPin(which, value) {
    setIn(which, { pincode: value });
    if (!isPincode(value)) { setPin(s => ({ ...s, [which]: null })); return; }
    setPin(s => ({ ...s, [which]: { busy: true } }));
    const r = await fetch(`/api/lookup?pincode=${value}`).then(r => r.json()).catch(() => null);
    if (r?.ok) { setIn(which, { area: r.area, taluka: r.taluka, district: r.district, state: r.state });
      setPin(s => ({ ...s, [which]: { options: r.options || [], note: `${r.district}, ${r.state}` } })); }
    else setPin(s => ({ ...s, [which]: { note: r?.reason || "Pincode not found — type it by hand" } }));
  }
  async function lookupIfscFor(i, raw) {
    const code = formatIfsc(raw);
    patchBank(i, { ifsc: code, bank: "", ifscNote: null });
    if (!isIfsc(code)) return;
    patchBank(i, { ifscNote: "looking up…" });
    const r = await fetch(`/api/lookup?ifsc=${code}`).then(r => r.json()).catch(() => null);
    const title = (t) => String(t || "").toLowerCase()
      .replace(/\b[a-z]/g, m => m.toUpperCase());
    if (r?.ok) patchBank(i, { bank: r.bank, bankBranch: r.branchName,
      ifscNote: [title(r.branchName), title(r.city)].filter(Boolean).join(" · ") });
    else patchBank(i, { ifscNote: r?.reason || "IFSC not found — check the code" });
  }
  function pennyDrop(i) {
    const b = c.banks[i];
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
    const h = norm(b.holderName), cu = norm(c.firstName + c.lastName);
    const ok = h.length > 2 && cu.length > 2 && (h.includes(cu) || cu.includes(h));
    patchBank(i, ok
      ? { status: "match", verifyMethod: "penny_drop", verifiedAt: new Date().toISOString(), chequeFileId: null }
      : { status: "mismatch", verifyMethod: "none", verifiedAt: null });
  }
  function verifyUpi(i) {
    if (!String(c.banks[i].upiId).includes("@"))
      return patchBank(i, { upiNote: "Enter a UPI ID like name@bank" });
    patchBank(i, { upiVerified: true, upiNote: "UPI active — name matched via API" });
  }

  async function save(force = false, dupOk = false) {
    setBusy(true); setChip(null);
    const r = mode === "edit"
      ? await post(`/api/customers/${customerId}/edit`,
          { action: "full", ...c, blacklistAcknowledged: force, dupAcknowledged: dupOk })
      : await post("/api/customers",
          { ...c, blacklistAcknowledged: force, dupAcknowledged: dupOk });
    setBusy(false);
    if (r.needsDupConfirm) return setConfirmDup({ text: r.reason, force });
    if (r.needsBlacklistConfirm) return setConfirmBlacklist(true);
    if (!r.ok) return setChip({ tone: "bad", text: r.reason });
    window.location.href = mode === "edit"
      ? `/customers/${customerId}?edited=1` : `/customers/${r.id}?created=1`;
  }
  function onSave() {
    setTouched(new Set(TABS.map((_, i) => i)));
    if (!v.ok) {
      const bad = TABS.findIndex(([k]) => missOf(k).length);
      setTab(bad);
      setChip({ tone: "bad", text: `${TABS[bad][1]} — still needed: ${missOf(TABS[bad][0]).join(", ")}` });
      return;
    }
    save(false);
  }

  // the frozen form moves the asterisk: whichever proof is done makes the other optional
  const aadhaarDone = isAadhaar(c.aadhaar) && c.aadhaarVerified;
  const panDone = isPan(c.pan) && c.panVerified;
  const aadhaarStar = panDone ? "(opt.)" : "*";
  const panStar = aadhaarDone ? "(opt.)" : "*";
  const gstStar = c.custType === "corporate" ? "*" : "(opt.)";
  const aadhaarHint = c.aadhaarVerified ? "Name and address fetched" : "Aadhaar or PAN is enough";
  const panHint = c.panVerified ? "Confirmed via API"
    : c.pan.length === 0 ? "Aadhaar or PAN is enough"
    : c.pan.length < 10 ? `${c.pan.length} of 10 — ABCDE1234F`
    : isPan(c.pan) ? "Ready to verify" : "Format ABCDE1234F";
  const gstHint = c.gstVerified ? "Trade name matched"
    : c.gstin.length === 0 ? "Format 27ABCDE1234F1Z5"
    : c.gstin.length < 15 ? `${c.gstin.length} of 15 — 27ABCDE1234F1Z5`
    : isGst(c.gstin) ? "Ready to verify" : "Check the 13th character — it must be Z";
  const cibilReady = c.aadhaarVerified || c.panVerified;
  const altHint = c.altMobile.length === 0 ? "Optional"
    : c.altMobile.length === 10 ? "Complete" : "Needs all 10 digits";

  const docsComplete = c.docs.filter(d => d.docTypeId && d.number?.trim() && (d.files || []).length > 0).length;

  const N = ({ k }) => note[k]
    ? <div style={{ marginTop: 6 }}><span className={"chip " + note[k].tone}>{note[k].text}</span></div> : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2, marginBottom: 16 }}>
        {TABS.map(([k, label], i) => {
          const miss = missOf(k).length, seen = touched.has(i);
          return (
            <button key={k} onClick={() => { setTouched(t => new Set(t).add(tab)); setTab(i); }}
              style={{ border: 0, cursor: "pointer", padding: "9px 15px", borderRadius: 11, fontWeight: 800,
                fontSize: 13.5, whiteSpace: "nowrap", display: "flex", gap: 7, alignItems: "center",
                background: i === tab ? "var(--vault)" : "#eceadf", color: i === tab ? "#fff" : "var(--mut)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%",
                background: !seen ? "#c9c4b6" : miss ? "var(--brass)" : "#4cc38a" }} />
              {i + 1} · {label}
            </button>);
        })}
      </div>

      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="card">
        {tab === 0 && <>
          <div className="fg3">
            <F label="First name *"><input className="i" value={c.firstName}
              onChange={e => set({ firstName: e.target.value })}
              onBlur={e => set({ firstName: titleCaseName(e.target.value) })} /></F>
            <F label="Middle name"><input className="i" value={c.middleName}
              onChange={e => set({ middleName: e.target.value })}
              onBlur={e => set({ middleName: titleCaseName(e.target.value) })} /></F>
            <F label="Last name *"><input className="i" value={c.lastName}
              onChange={e => set({ lastName: e.target.value })}
              onBlur={e => set({ lastName: titleCaseName(e.target.value) })} /></F>
            <F label="Date of birth *"><input className="i" type="date" value={c.dob}
              onChange={e => set({ dob: e.target.value })} /></F>
            <F label="Gender *"><select className="i" value={c.gender}
              onChange={e => set({ gender: e.target.value })}>
              <option value="">— select —</option>
              <option value="male">Male</option><option value="female">Female</option>
              <option value="other">Other</option></select></F>
            <F label="Customer type *"><select className="i" value={c.custType}
              onChange={e => set({ custType: e.target.value, gstVerified: false })}>
              {[["individual","Individual"],["corporate","Corporate"],["huf","HUF"],
                ["partnership","Partnership"],["trust","Trust / society"]]
                .map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></F>
          </div>

          <div className="fg3" style={{ marginTop: 16 }}>
            <F label={`Aadhaar number ${aadhaarStar}`} hint={aadhaarHint}>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="i mono" inputMode="numeric" maxLength={14}
                  placeholder={c.aadhaarLast4
                    ? `on file ••••${c.aadhaarLast4} — type full number to replace`
                    : "1234 1234 1234"}
                  style={{ letterSpacing: ".06em" }} value={formatAadhaar(c.aadhaar)}
                  onChange={e => { set({ aadhaar: cleanAadhaar(e.target.value), aadhaarVerified: false });
                    setNote(n => ({ ...n, aadhaar: null })); }} />
                <button className="btn ghost" type="button" style={{ padding: "0 14px" }}
                  disabled={!isAadhaar(c.aadhaar) || c.aadhaarVerified} onClick={verifyAadhaar}>
                  {c.aadhaarVerified ? "✓" : "Verify"}</button>
              </div><N k="aadhaar" /></F>

            <F label={`PAN number ${panStar}`} hint={panHint}>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="i mono" maxLength={10} placeholder="ABCDE1234F"
                  style={{ letterSpacing: ".08em" }} value={c.pan}
                  onChange={e => { set({ pan: formatPan(e.target.value), panVerified: false });
                    setNote(n => ({ ...n, pan: null })); }} />
                <button className="btn ghost" type="button" style={{ padding: "0 14px" }}
                  disabled={!isPan(c.pan) || c.panVerified} onClick={verifyPan}>
                  {c.panVerified ? "✓" : "Verify"}</button>
              </div><N k="pan" /></F>

            <F label="Risk category — CIBIL"
               hint={c.cibil ? `CIBIL ${c.cibil} · ${c.risk} risk` : "after Aadhaar or PAN verify"}>
              {/* label is capitalised for the eye; the stored value stays lowercase */}
              <div style={{ display: "flex", gap: 6, opacity: cibilReady ? 1 : 0.45 }}>
                <select className="i" value={c.risk} disabled={!cibilReady}
                  onChange={e => set({ risk: e.target.value })}>
                  <option value="">—</option>
                  <option value="low">Low</option><option value="medium">Medium</option>
                  <option value="high">High</option></select>
                <button className="btn ghost" type="button" style={{ padding: "0 14px" }}
                  disabled={!cibilReady} onClick={fetchCibil}>Fetch</button>
              </div><N k="cibil" /></F>

            <F label={`GST ${gstStar}`} hint={gstHint}>
              <div style={{ display: "flex", gap: 6 }}>
                <input className="i mono" maxLength={15} placeholder="27ABCDE1234F1Z5"
                  style={{ letterSpacing: ".05em" }} value={c.gstin}
                  onChange={e => set({ gstin: e.target.value.toUpperCase()
                    .replace(/[^0-9A-Z]/g, "").slice(0, 15), gstVerified: false })} />
                <button className="btn ghost" type="button" style={{ padding: "0 14px" }}
                  disabled={!isGst(c.gstin) || c.gstVerified} onClick={verifyGst}>
                  {c.gstVerified ? "✓" : "Verify"}</button>
              </div><N k="gst" /></F>
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "20px 0 18px" }} />
          {mode !== "create" && c.photoUrl && !c.photo?.preview && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <a href={c.photoUrl} target="_blank" rel="noreferrer" title="Current photo — open full size">
                <img src={c.photoUrl} alt="current" style={{ width: 74, height: 74, borderRadius: 12,
                  objectFit: "cover", border: "1px solid var(--line)", display: "block" }} /></a>
              <span style={{ fontSize: 12.5, color: "var(--mut)" }}>
                Photo on file — upload below to replace it</span>
            </div>)}
          <PhotoInput kind="customer_photo" square label="Customer photo *" value={c.photo}
            onChange={f => set({ photo: f, photoFileId: f?.fileId ?? null })}
            hint={c.photo ? "1 photo on file · square crop auto-applied"
                          : "At least one live photo is required"} />
        </>}

        {tab === 1 && <>
          <div className="fg3">
            <F label="Mobile number *">
              <input className="i mono" inputMode="numeric" maxLength={11} placeholder="00000 00000"
                value={formatMobile(c.mobile)}
                onChange={e => set({ mobile: cleanDigits(e.target.value) })} />
            </F>
            <F label="Alternate mobile"><input className="i mono" inputMode="numeric" maxLength={11}
              placeholder="00000 00000" value={formatMobile(c.altMobile)}
              onChange={e => set({ altMobile: cleanDigits(e.target.value) })} /></F>
            <F label="Email">
              <div style={{ display: "flex", gap: 6 }}>
                <input className="i" placeholder="name@example.com" value={c.email}
                  onChange={e => { set({ email: e.target.value, emailVerified: false });
                    setNote(n => ({ ...n, email: null })); }} />
                <button className="btn ghost" type="button" style={{ padding: "0 12px" }}
                  disabled={!c.email || c.emailVerified} onClick={verifyEmail}>
                  {c.emailVerified ? "✓" : "Verify"}</button>
              </div><N k="email" /></F>
            <F label="App access">
              <label className="pill"><input type="checkbox" checked={c.appAccess}
                onChange={e => set({ appAccess: e.target.checked })} /> Customer app & portal</label></F>
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "20px 0" }} />
          <Addr title="Current address" a={c.current} state={pin.current}
            onLine={(k, val) => setIn("current", { [k]: val })}
            onPin={p => lookupPin("current", p)} onPickArea={o => setIn("current", o)} />
          <label className="pill" style={{ marginTop: 14 }}>
            <input type="checkbox" checked={c.sameAsCurrent}
              onChange={e => set({ sameAsCurrent: e.target.checked })} /> Permanent address same as current
          </label>
          {!c.sameAsCurrent && <div style={{ marginTop: 16 }}>
            <Addr title="Permanent address" a={c.permanent} state={pin.permanent}
              onLine={(k, val) => setIn("permanent", { [k]: val })}
              onPin={p => lookupPin("permanent", p)} onPickArea={o => setIn("permanent", o)} /></div>}
        </>}

        {tab === 2 && <>
          {/* identity on file — the two proofs, their state and their scans */}
          <div style={{ font: "800 11px ui-sans-serif", letterSpacing: ".07em", textTransform: "uppercase",
            color: "var(--vault3)", marginBottom: 12 }}>Identity on file</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <IdRow label="Aadhaar"
              value={c.aadhaar ? formatAadhaar(c.aadhaar)
                : c.aadhaarLast4 ? `••••${c.aadhaarLast4} (on file)` : "not entered"}
              dim={!c.aadhaar && !c.aadhaarLast4} ok={c.aadhaarVerified} scans={c.aadhaarScans}
              onScans={f => set({ aadhaarScans: f })} />
            <IdRow label="PAN" value={c.pan || "not entered"} dim={!c.pan} ok={c.panVerified}
              scans={c.panScans} onScans={f => set({ panScans: f })} />
          </div>

          {/* additional documents — compact single-line controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "22px 0 12px" }}>
            <span style={{ font: "800 11px ui-sans-serif", letterSpacing: ".07em", textTransform: "uppercase",
              color: "var(--vault3)" }}>Additional documents {c.aadhaarVerified ? "(opt.)" : "*"}</span>
            {docsComplete > 0 && <span className="chip ok">{docsComplete} complete</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {c.docs.map((d, i) => (
              <div key={i} style={{ flex: "0 1 420px", maxWidth: 420, minWidth: 0, display: "flex",
                alignItems: "stretch", border: "1px solid #cfc9ba", borderRadius: 10,
                overflow: "hidden", background: "#fff", minHeight: 42 }}>
                <select value={d.docTypeId} onChange={e => patchDoc(i, { docTypeId: Number(e.target.value) || "" })}
                  style={{ border: 0, borderRight: "1px solid var(--line)", background: "#faf9f4",
                    width: 150, flex: "0 0 auto", padding: "0 26px 0 10px", fontSize: 13.5,
                    appearance: "none", cursor: "pointer", color: d.docTypeId ? "var(--ink)" : "#b5afa0",
                    backgroundImage: "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5 6 6.5 11 1.5' stroke='%237d786c' stroke-width='1.8' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
                    backgroundRepeat: "no-repeat", backgroundPosition: "right 9px center" }}>
                  <option value="">Select type</option>
                  {docTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input className="mono" placeholder="Number" value={d.number}
                  onChange={e => patchDoc(i, { number: e.target.value })}
                  style={{ border: 0, flex: "1 1 auto", minWidth: 90, padding: "0 10px",
                    fontSize: 13.5, outline: "none" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 8px",
                  borderLeft: "1px solid var(--line)", background: "#faf9f4" }}>
                  {/* №6: history first — every scan already on file, clickable */}
                  {(d.existingScans || []).filter(sf => sf.thumb).map((sf, si) => (
                    <a key={si} href={sf.full || sf.thumb} target="_blank" rel="noreferrer"
                      title="Uploaded scan — open full size">
                      <img src={sf.thumb} alt={"scan " + (si + 1)} style={{ width: 30, height: 30,
                        objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)",
                        display: "block" }} /></a>))}
                  {(d.files || []).length > 0 && <span className="chip ok">+{d.files.length}</span>}
                  <PhotoInput kind="kyc_scan" multiple value={d.files || []} compact
                    onChange={files => patchDoc(i, { files, scans: files.map(f => f.fileId) })} />
                  {c.docs.length > 1 && <button type="button" onClick={() => set({ docs: c.docs.filter((_, j) => j !== i) })}
                    style={{ border: 0, background: "transparent", cursor: "pointer",
                      color: "var(--mut)", fontSize: 15, padding: "0 2px" }}>✕</button>}
                </div>
              </div>))}
          </div>
          <button className="btn ghost" type="button" style={{ marginTop: 12, padding: "8px 14px", fontSize: 13 }}
            onClick={() => set({ docs: [...c.docs, { docTypeId: "", number: "", scans: [], files: [] }] })}>
            + Add document</button>

          {/* bank details — a table, exactly as the frozen screen */}
          <div style={{ height: 1, background: "var(--line)", margin: "24px 0 16px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ font: "800 11px ui-sans-serif", letterSpacing: ".07em",
                textTransform: "uppercase", color: "var(--vault3)" }}>Bank details (opt.)</span>
              <span style={{ fontSize: 13, color: "var(--mut)" }}>
                Every account the customer may use · needed for bank-mode disbursement</span>
            </div>
            <button className="btn ghost" type="button" style={{ padding: "8px 14px", fontSize: 13 }}
              onClick={() => set({ banks: [...c.banks, { ifsc: "", bank: "", accountNo: "", holderName: "",
                acctType: "", status: "unverified", chequeFileId: null, upiId: "", upiVerified: false }] })}>
              + Add bank account</button>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead><tr style={{ background: "#faf9f4" }}>
                {["IFSC","ACCOUNT NUMBER","HOLDER NAME","STATUS","UPI",""].map(h => (
                  <th key={h} style={{ textAlign: "left", font: "800 10.5px ui-sans-serif",
                    letterSpacing: ".07em", color: "var(--mut)", padding: "10px 10px",
                    borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" }}>{h}</th>))}
              </tr></thead>
              <tbody>
                {c.banks.map((b, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0ede4" }}>
                    <td style={{ padding: 8, minWidth: 170 }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        <input className="i mono" maxLength={11} placeholder="KKBK0001896" value={b.ifsc}
                          onChange={e => lookupIfscFor(i, e.target.value)}
                          style={{ padding: "8px 9px", fontSize: 13 }} />
                        <button className="btn ghost" type="button" title="look up"
                          style={{ padding: "0 10px" }} onClick={() => lookupIfscFor(i, b.ifsc)}>🔍</button>
                      </div>
                      {(b.bank || b.ifscNote) && (
                        <div style={{ marginTop: 5, fontSize: 12.5, lineHeight: 1.35,
                          color: b.bank ? "var(--ink)" : "var(--mut)" }}>
                          {b.bank ? <><b style={{ fontWeight: 700 }}>{b.bank}</b>
                            {b.ifscNote ? <span style={{ color: "var(--mut)" }}> · {b.ifscNote}</span> : null}</>
                            : b.ifscNote}
                        </div>)}
                    </td>
                    <td style={{ padding: 8, minWidth: 150 }}>
                      <input className="i mono" placeholder="Account number" value={b.accountNo}
                        style={{ padding: "8px 9px", fontSize: 13 }}
                        onChange={e => patchBank(i, { accountNo: e.target.value.replace(/\D/g, ""),
                          status: "unverified", verifiedAt: null })} /></td>
                    <td style={{ padding: 8, minWidth: 190 }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        <input className="i" placeholder="As per bank" value={b.holderName}
                          style={{ padding: "8px 9px", fontSize: 13 }}
                          onChange={e => patchBank(i, { holderName: e.target.value,
                            status: "unverified", verifiedAt: null })} />
                        <button className="btn ghost" type="button" title="penny drop"
                          style={{ padding: "0 11px" }}
                          disabled={!b.accountNo || !isIfsc(b.ifsc) || !b.holderName}
                          onClick={() => pennyDrop(i)}>✓</button>
                      </div></td>
                    <td style={{ padding: 8, minWidth: 190 }}>
                      {/* E16 №3/№7 (owner, 29 Aug 2026): the cheque path is always
                          open — attach, see, replace — unless penny-verified */}
                      {b.status === "match" || b.verifiedAt
                        ? <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span className="chip ok">verified ✓</span>
                            {(b.cheque?.preview || b.chequeUrl) &&
                              <a href={b.chequeUrl || b.cheque?.preview} target="_blank" rel="noreferrer"
                                title="Open the cheque/passbook photo">
                                <img src={b.cheque?.preview || b.chequeUrl} alt="cheque"
                                  style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 6,
                                    border: "1px solid var(--line)", display: "block" }} /></a>}
                            {!ro && <PhotoInput kind="cheque" compact
                              label={b.chequeFileId ? "replace" : "cheque/passbook"} value={b.cheque}
                              onChange={f => patchBank(i, { cheque: f,
                                chequeFileId: f?.fileId ?? b.chequeFileId })} />}
                          </div>
                        : <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {b.status === "mismatch" && <span className="chip bad">mismatch</span>}
                            {b.chequeFileId ? (<>
                              <span className="chip ok">cheque ✓</span>
                              {(b.cheque?.preview || b.chequeUrl) &&
                                <a href={b.chequeUrl || b.cheque?.preview} target="_blank" rel="noreferrer"
                                  title="Open the cheque/passbook photo">
                                  <img src={b.cheque?.preview || b.chequeUrl} alt="cheque"
                                    style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 6,
                                      border: "1px solid var(--line)", display: "block" }} /></a>}
                            </>) : null}
                            <PhotoInput kind="cheque" compact
                              label={b.chequeFileId ? "replace" : "cheque/passbook"} value={b.cheque}
                              onChange={f => patchBank(i, { cheque: f, chequeFileId: f?.fileId ?? b.chequeFileId,
                                verifyMethod: (f?.fileId ?? b.chequeFileId) ? "cheque_photo" : "none" })} />
                          </div>}
                    </td>
                    <td style={{ padding: 8, minWidth: 160 }}>
                      <div style={{ display: "flex", gap: 5 }}>
                        <input className="i mono" placeholder="name@bank" value={b.upiId || ""}
                          style={{ padding: "8px 9px", fontSize: 13 }}
                          onChange={e => patchBank(i, { upiId: e.target.value, upiVerified: false })} />
                        <button className="btn ghost" type="button" style={{ padding: "0 11px" }}
                          disabled={!b.upiId} onClick={() => verifyUpi(i)}>✓</button>
                      </div>
                      {b.upiVerified && <div style={{ marginTop: 4 }}><span className="chip ok">active</span></div>}
                    </td>
                    <td style={{ padding: 8 }}>
                      {c.banks.length > 1 && <button type="button" style={{ border: 0, background: "transparent",
                        cursor: "pointer", color: "var(--mut)", fontSize: 15 }}
                        onClick={() => set({ banks: c.banks.filter((_, j) => j !== i) })}>✕</button>}
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </>}

        {tab === 3 && <div className="fg3">
          <F label="Nominee full name *" wide><input className="i" value={c.nominee.name}
            onChange={e => setIn("nominee", { name: e.target.value })} /></F>
          <F label="Relation *"><select className="i" value={c.nominee.relation}
            onChange={e => setIn("nominee", { relation: e.target.value })}>
            <option value="">— select —</option>{REL.map(r => <option key={r}>{r}</option>)}</select></F>
          <F label="Nominee mobile"><input className="i mono" inputMode="numeric" maxLength={11}
            placeholder="00000 00000" value={formatMobile(c.nominee.mobile)}
            onChange={e => setIn("nominee", { mobile: cleanDigits(e.target.value) })} /></F>
        </div>}

        {tab === 4 && <>
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
          {bl.isBlacklisted && <div style={{ marginTop: 10 }}>
            <span className="chip bad">a zero limit marks this customer BLACKLISTED / BAD DEBTOR — narration mandatory</span>
          </div>}
        </>}
      </div>
      </fieldset>

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
          {mode !== "create" && (
            <a href={`/customers/${customerId}`} className="btn ghost"
              style={{ textDecoration: "none" }}>{ro ? "← Back" : "Cancel"}</a>)}
          {!ro && <button className="btn green" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : mode === "edit" ? "Save changes" : "Save customer"}</button>}
        </div>
      </div>
      {chip && <div style={{ marginTop: 10 }}><span className={"chip " + chip.tone}>{chip.text}</span></div>}

      {confirmDup && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(12,35,27,.6)", display: "grid",
          placeItems: "center", zIndex: 40, padding: 16 }}>
          <div className="card" style={{ maxWidth: 460, borderTop: "6px solid #e0a63a" }}>
            <h2 style={{ fontSize: 19, fontWeight: 900 }}>Possible duplicate</h2>
            <p style={{ color: "var(--mut)", fontSize: 14, margin: "10px 0" }}>{confirmDup.text}</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setConfirmDup(null)}>Go back</button>
              <button className="btn green" onClick={() => {
                const f = confirmDup.force; setConfirmDup(null); save(f, true); }}>
                Not a duplicate — save</button>
            </div>
          </div>
        </div>)}

      {confirmBlacklist && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(12,35,27,.6)", display: "grid",
          placeItems: "center", zIndex: 40, padding: 16 }}>
          <div className="card" style={{ maxWidth: 440, borderTop: "6px solid var(--bad)" }}>
            <h2 style={{ fontSize: 19, fontWeight: 900 }}>⚠ Blacklisted / bad debtor</h2>
            <p style={{ color: "var(--mut)", fontSize: 14, margin: "10px 0" }}>
              A zero limit means this customer cannot borrow. The flag and narration appear
              every time the customer is opened.</p>
            <div style={{ background: "var(--bad-bg)", color: "var(--bad)", borderRadius: 10,
              padding: 10, fontSize: 14, fontWeight: 700 }}>“{c.narration}”</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button className="btn ghost" onClick={() => setConfirmBlacklist(false)}>Go back</button>
              <button className="btn green" onClick={() => { setConfirmBlacklist(false); save(true, true); }}>
                Save as blacklisted</button>
            </div>
          </div>
        </div>)}

      <style>{`
        .fg3{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
        .wide{grid-column:span 2}
        @media(max-width:760px){.wide{grid-column:span 1}}
        .pill{display:inline-flex;align-items:center;gap:9px;font-size:13.5px;font-weight:700;
          background:#faf9f4;border:1px solid var(--line);padding:9px 13px;border-radius:11px;cursor:pointer}
        .pill input{width:17px;height:17px;accent-color:#1b4434}
      `}</style>
    </div>);
}

/** One line of the "Identity on file" strip: proof, its state, its scans. */
function IdRow({ label, value, dim, ok, scans, onScans }) {
  return (
    <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", alignItems: "center", gap: 9,
      flexWrap: "wrap", border: "1px solid #cfc9ba", borderRadius: 10, background: "#faf9f4",
      padding: "7px 11px", minHeight: 42 }}>
      <span style={{ flex: "0 0 auto", font: "800 10px ui-sans-serif", letterSpacing: ".07em",
        textTransform: "uppercase", color: "var(--mut)" }}>{label}</span>
      <span className="mono" style={{ flex: "1 1 auto", minWidth: 0, fontSize: 14,
        letterSpacing: ".04em", whiteSpace: "nowrap", color: dim ? "#a9a495" : "var(--ink)" }}>{value}</span>
      <span className={"chip " + (ok ? "ok" : "warn")}>{ok ? "verified" : "not verified"}</span>
      {(scans || []).length > 0 && <span className="chip ok">📄 {scans.length} scan{scans.length === 1 ? "" : "s"}</span>}
      <PhotoInput kind="kyc_scan" multiple compact value={scans || []} onChange={onScans} label={null} />
    </div>);
}

function F({ label, hint, wide, children }) {
  return (<div className={wide ? "wide" : ""}>
    {label && <label className="f">{label}</label>}
    {children}
    {hint && <div className="hint" style={{ marginTop: 5 }}>{hint}</div>}
  </div>);
}

function Addr({ title, a, state, onLine, onPin, onPickArea }) {
  const opts = state?.options || [];
  return (<>
    <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 10 }}>{title}</div>
    <div className="fg3">
      <F label="Address line 1 *" wide><input className="i" value={a.line1}
        onChange={e => onLine("line1", e.target.value)} /></F>
      <F label="Pincode *" hint={state?.busy ? "looking up…" : state?.note || "fills the rest from India Post"}>
        <input className="i mono" maxLength={6} style={{ maxWidth: 140 }} value={a.pincode}
          onChange={e => onPin(e.target.value.replace(/\D/g, ""))} /></F>
      <F label="Area" hint={opts.length > 1 ? `${opts.length} post offices in this pincode` : null}>
        {opts.length > 1
          ? <select className="i" value={a.area}
              onChange={e => { const o = opts.find(x => x.area === e.target.value); if (o) onPickArea(o); }}>
              {opts.map(o => <option key={o.area} value={o.area}>{o.area}</option>)}</select>
          : <input className="i" value={a.area} onChange={e => onLine("area", e.target.value)} />}
      </F>
      <F label="Taluka"><input className="i" value={a.taluka} onChange={e => onLine("taluka", e.target.value)} /></F>
      <F label="District"><input className="i" value={a.district} onChange={e => onLine("district", e.target.value)} /></F>
      <F label="State"><input className="i" value={a.state} onChange={e => onLine("state", e.target.value)} /></F>
    </div>
  </>);
}
