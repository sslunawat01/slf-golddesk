"use client";
import { useState, useMemo } from "react";
import PhotoInput from "@/components/PhotoInput.js";
import { ornamentValue, appraisalTotals, validPrincipal, valuerRule,
         disbursementPlan, docCharge, inr, bankRemainder } from "@/lib/valuation.js";

const g = (mg) => (Number(mg || 0) / 1000).toFixed(3);
const mg = (grams) => Math.round(Number(grams || 0) * 1000);

export default function WizardClient({ app, customer, items, purities, schemes, itemMaster, valuers,
                                       banks, slfAccounts, ceilingPaise, base24k, funding24k,
                                       valuer2Threshold, canDisburse, youApproved = false, metals = [], ratedMetalId = 1 }) {
  const [step, setStep] = useState(app.status === "approved" ? 3 : app.status === "pending_ho" ? 2 : 1);
  const [sendBack, setSendBack] = useState(null);   // №11: null | { note } — the send-back box
  const [rows, setRows] = useState(items.length
    ? items.map(r => ({ ...r, metalId: String(purities.find(p => String(p.id) === String(r.purityId))?.metalId || ratedMetalId) }))
    : [newRow()]);
  const [photos, setPhotos] = useState(app.ornamentPhotos || []);
  const [schemeId, setSchemeId] = useState(app.schemeVersionId || "");
  const [amount, setAmount] = useState(app.requestedPaise ? String(app.requestedPaise / 100) : "");
  const [purpose, setPurpose] = useState(app.purpose || "personal");
  const [present, setPresent] = useState(app.borrowerPresent ?? true);
  const [presencePhoto, setPresencePhoto] = useState(null);
  const [cob, setCob] = useState(app.coborrowerCustomerId
    ? { on: true, picked: { id: app.coborrowerCustomerId, name: app.coborrowerName || "co-borrower on file" }, q: "", results: [] }
    : { on: false, picked: null, q: "", results: [] });
  const [cobPhoto, setCobPhoto] = useState(null);
  const [docs, setDocs] = useState([]);
  const [v1, setV1] = useState(app.valuer1Id || "");
  const [v2, setV2] = useState(app.valuer2Id || "");
  const [cash, setCash] = useState("");
  const [legs, setLegs] = useState({});
  const [slfAcc, setSlfAcc] = useState(slfAccounts[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(null);
  const [status, setStatus] = useState(app.status);
  const [done, setDone] = useState(null);

  function newRow() { return { itemId: "", metalId: String(ratedMetalId), qty: 1, gross: "", stone: "0", purityId: "", narration: "" }; }
  const metalName = (id) => metals.find(m => String(m.id) === String(id))?.kind || "gold";
  const forMetal = (list, id) => list.filter(x => String(x.metalId) === String(id));
  const scheme = schemes.find(s => String(s.id) === String(schemeId));
  const fundingPct = Number(scheme?.fundingPct || 0);

  const priced = useMemo(() => rows.map(r => {
    const p = purities.find(x => String(x.id) === String(r.purityId));
    // The application snapshots ONE rate pair. Until a metal has its own snapshot we
    // refuse to price it rather than quietly using the gold rate (O7 still open).
    const unrated = String(r.metalId) !== String(ratedMetalId);
    const liveNetMg = Math.max(0, mg(r.gross) - mg(r.stone));   // №1: net = gross − stone, immediately; stone may be 0
    if (unrated) return { ...r, netMg: liveNetMg, marketPaise: 0, fundingPaise: 0, unrated: true };
    if (!r.itemId || !r.gross || !p) return { ...r, netMg: liveNetMg, marketPaise: 0, fundingPaise: 0 };
    const v = ornamentValue({ grossMg: mg(r.gross), stoneMg: mg(r.stone), purityPct: Number(p.purityPct),
      base24kPaise: base24k, funding24kPaise: funding24k, fundingPct });
    return { ...r, ...v, grossMg: mg(r.gross), stoneMg: mg(r.stone) };
  }), [rows, purities, fundingPct, base24k, funding24k, ratedMetalId]);
  const anyUnrated = priced.some(r => r.unrated);

  const totals = appraisalTotals(priced);
  const principalPaise = Math.round(Number(amount || 0) * 100);
  const pv = validPrincipal(principalPaise, { maxFundingPaise: totals.fundingPaise,
    minLoanPaise: Number(scheme?.minLoanPaise || 0), maxLoanPaise: Number(scheme?.maxLoanPaise || 0) || Infinity });
  const vr = valuerRule(principalPaise, valuer2Threshold, v1 || null, v2 || null);
  const aboveCeiling = ceilingPaise != null && principalPaise > ceilingPaise;

  const charge = scheme ? docCharge({ principalPaise, pct: Number(scheme.docChargePct || 0),
    minPaise: Number(scheme.docChargeMinPaise || 0), maxPaise: Number(scheme.docChargeMaxPaise || 0), gstPct: 18 })
    : { totalPaise: 0, basePaise: 0, gstPaise: 0 };

  const bankLegs = Object.entries(legs).filter(([, v]) => Number(v) > 0)
    .map(([id, v]) => ({ accountId: Number(id), amountPaise: Math.round(Number(v) * 100),
      verified: !!banks.find(b => String(b.id) === String(id))?.payable }));
  // R-D2 — the customer receives the full sanctioned amount; the charge is collected later.
  const payablePaise = principalPaise;
  const plan = disbursementPlan({ principalPaise,
    cashPaise: Math.round(Number(cash || 0) * 100), bankLegs });

  /** Keying cash re-fills the single ticked bank account with whatever is left. */
  function onCash(v) {
    setCash(v);
    const ids = Object.keys(legs);
    if (ids.length === 1)
      setLegs({ [ids[0]]: String(bankRemainder({ payablePaise, cashPaise: Math.round(Number(v || 0) * 100) }) / 100) });
  }
  /** Ticking an account allocates the outstanding balance to it; unticking clears it. */
  function toggleBank(id) {
    if (legs[id] !== undefined) { const next = { ...legs }; delete next[id]; setLegs(next); return; }
    const others = Object.values(legs).reduce((t, v) => t + Math.round(Number(v || 0) * 100), 0);
    const left = Math.max(0, payablePaise - Math.round(Number(cash || 0) * 100) - others);
    setLegs({ ...legs, [id]: String(left / 100) });
  }

  async function save(extra = {}) {
    const body = {
      items: priced.filter(r => r.itemId && r.grossMg > 0).map(r => ({
        itemId: Number(r.itemId), qty: Number(r.qty || 1), grossMg: r.grossMg,
        stoneMg: r.stoneMg, purityId: Number(r.purityId), narration: r.narration })),
      ornamentPhotoIds: photos.map(p => p.fileId),
      schemeVersionId: schemeId ? Number(schemeId) : null,
      requestedPaise: principalPaise || null, purpose,
      borrowerPresent: present, presencePhotoId: presencePhoto?.fileId ?? null,
      coborrowerCustomerId: cob.on && cob.picked ? Number(cob.picked.id) : null,
      coborrowerPhotoId: cob.on && cob.picked ? (cobPhoto?.fileId ?? null) : null,
      documents: docs.map(d => ({ fileId: d.file.fileId, note: d.note || null })),
      valuer1Id: v1 ? Number(v1) : null, valuer2Id: v2 ? Number(v2) : null, ...extra };
    const r = await fetch(`/api/applications/${app.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json());
    return r;
  }

  async function act(action, extra = {}) {
    setBusy(true); setChip(null);
    if (!["cancel", "disburse", "sendback"].includes(action)) { const s = await save(); if (!s.ok) { setBusy(false); setChip({ tone: "bad", text: s.reason }); return; } }
    const r = await fetch(`/api/applications/${app.id}/action`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...extra }),
    }).then(async r => {
      const body = await r.json().catch(() => null);
      return body ?? { ok: false, reason: `Server error ${r.status} — nothing was saved` };
    }).catch(() => ({ ok: false, reason: "Cannot reach the server — check the connection" }));
    setBusy(false);
    if (!r.ok) { setChip({ tone: "bad", text: r.reason }); return; }
    if (action === "submit") { setStatus(r.status); setStep(3); setChip(r.needsHo
      ? { tone: "warn", text: `Above your ceiling of ${inr(r.ceilingPaise)} — sent to Head Office` }
      : { tone: "ok", text: "Approved within branch authority — ready to disburse" }); }
    if (action === "disburse") setDone(r);
    if (action === "cancel") window.location.href = `/customers/${customer.id}`;
    if (action === "sendback") window.location.href = "/home?sentback=1";   // №11
  }

  if (done) return (
    <div className="card" style={{ maxWidth: 620, borderTop: "6px solid var(--ok)" }}>
      <span className="chip ok">loan activated</span>
      <div className="mono" style={{ fontSize: 30, fontWeight: 900, marginTop: 10 }}>{done.loanNo}</div>
      <div style={{ color: "var(--mut)", marginTop: 6 }}>
        {customer.fullName} · {inr(principalPaise)} · {g(totals.netMg)} g</div>
      <div style={{ background: "#faf9f4", borderRadius: 12, padding: 14, marginTop: 16, fontSize: 14 }}>
        <b>Vault-in is due tomorrow.</b> The ornaments stay at the counter tonight; the packet is
        sealed and entered into the safe at the next working day's recheck.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button className="btn ghost" disabled>🖨 Appraisal note</button>
        <button className="btn ghost" disabled>🖨 Loan agreement + KFS</button>
        <a className="btn green" href={`/customers/${customer.id}`}>Back to customer</a>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>Print layouts arrive in Sprint 3.</div>
    </div>);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {[[1, "Appraisal"], [2, "Scheme, amount & people"], [3, "Disbursement"]].map(([n, label]) => (
          <button key={n} onClick={() => setStep(n)}
            disabled={(n > 1 && !totals.netMg) || (status === "approved" && n !== 3)}
            style={{ border: 0, padding: "9px 16px", borderRadius: 11, fontWeight: 800, fontSize: 13.5,
              cursor: status === "approved" && n !== 3 ? "not-allowed" : "pointer",
              opacity: status === "approved" && n !== 3 ? .45 : 1,
              background: step === n ? "var(--vault)" : "#eceadf",
              color: step === n ? "#fff" : "var(--mut)" }}>{n} · {label}</button>))}
        {status === "approved" && (
          <span className="chip mut" title="№11: an approved file is read-only — send it back to change anything">
            🔒 approved — details locked</span>)}
      </div>

      {/* ——— STEP 1 ——— */}
      {step === 1 && (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 860 }}>
              <thead><tr style={{ color: "var(--mut)", fontSize: 10.5, textAlign: "left" }}>
                {["ITEM","METAL","QTY","GROSS g","STONE g","NET g","PURITY","MARKET VALUE","FUNDING VALUE",""]
                  .map(h => <th key={h} style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {priced.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 6, minWidth: 155 }} className="grid-cell">
                      <select className="i" value={r.itemId} onChange={e => patch(i, { itemId: e.target.value })}>
                        <option value="">— item —</option>
                        {forMetal(itemMaster, r.metalId).map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </select></td>
                    <td style={{ padding: 6, minWidth: 100 }} className="grid-cell">
                      <select className="i" value={r.metalId}
                        onChange={e => patch(i, { metalId: e.target.value, itemId: "", purityId: "" })}>
                        {metals.map(m => <option key={m.id} value={m.id}>
                          {m.kind.charAt(0).toUpperCase() + m.kind.slice(1)}</option>)}
                      </select></td>
                    <td style={{ padding: 6, width: 70 }}>
                      <input className="i mono" value={r.qty} onChange={e => patch(i, { qty: e.target.value.replace(/\D/g,"") })} /></td>
                    <td style={{ padding: 6, width: 100 }}>
                      <input className="i mono" value={r.gross} placeholder="0.000"
                        onChange={e => patch(i, { gross: e.target.value.replace(/[^\d.]/g,"") })} /></td>
                    <td style={{ padding: 6, width: 100 }}>
                      <input className="i mono" value={r.stone}
                        onChange={e => patch(i, { stone: e.target.value.replace(/[^\d.]/g,"") })} /></td>
                    <td style={{ padding: 6 }} className="mono"><b>{g(r.netMg)}</b></td>
                    <td style={{ padding: 6, minWidth: 118 }} className="grid-cell">
                      <select className="i" value={r.purityId} onChange={e => patch(i, { purityId: e.target.value })}>
                        <option value="">— purity —</option>
                        {forMetal(purities, r.metalId).map(p => <option key={p.id} value={p.id}>{p.karat}</option>)}
                      </select></td>
                    <td style={{ padding: 6 }} className="mono">
                      {r.unrated ? <span className="chip warn" style={{ fontSize: 11 }}>no {metalName(r.metalId)} rate</span>
                        : r.marketPaise ? inr(r.marketPaise) : "—"}</td>
                    <td style={{ padding: 6, color: "#a8791f", fontWeight: 800 }} className="mono">
                      {r.fundingPaise ? inr(r.fundingPaise) : "—"}</td>
                    <td style={{ padding: 6 }}>{rows.length > 1 &&
                      <button className="btn ghost" style={{ padding: "6px 9px", fontSize: 12 }}
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}</td>
                  </tr>))}
                <tr style={{ borderTop: "2px solid var(--ink)", fontWeight: 800 }}>
                  <td style={{ padding: "10px 8px" }}>{totals.items} item(s)</td>
                  <td style={{ padding: "10px 8px", fontSize: 12, color: "var(--mut)", fontWeight: 700 }}>
                    {[...new Set(rows.map(r => metalName(r.metalId)))].join(" + ")}</td>
                  <td className="mono" style={{ padding: "10px 8px" }}>{totals.qty}</td>
                  <td className="mono" style={{ padding: "10px 8px" }}>{g(totals.grossMg)}</td>
                  <td className="mono" style={{ padding: "10px 8px" }}>{g(totals.stoneMg)}</td>
                  <td className="mono" style={{ padding: "10px 8px" }}>{g(totals.netMg)}</td>
                  <td />
                  <td className="mono" style={{ padding: "10px 8px" }}>{inr(totals.marketPaise)}</td>
                  <td className="mono" style={{ padding: "10px 8px", color: "#a8791f" }}>{inr(totals.fundingPaise)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <button className="btn ghost" style={{ marginTop: 10, fontSize: 13, padding: "7px 12px" }}
            onClick={() => setRows([...rows, newRow()])}>+ Add ornament</button>

          {anyUnrated && <div style={{ marginTop: 12 }}>
            <span className="chip warn">a rate pair for that metal is not yet published — silver pricing
              is still an open decision (O7), so those rows cannot be valued</span></div>}

          {!schemeId && <div style={{ marginTop: 12 }}>
            <span className="chip warn">choose a scheme in step 2 — funding value needs its percentage</span></div>}

          <div style={{ marginTop: 18 }}>
            <PhotoInput kind="ornament_set" multiple label="Photograph all ornaments together *"
              value={photos} onChange={setPhotos}
              hint="One set of photos for the whole pledge — this is the evidence of record." />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 14, marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <div><label className="f">Valuer 1 *</label>
              <select className="i" value={v1} onChange={e => setV1(e.target.value)}>
                <option value="">— select valuer —</option>{valuers.map(v => <option key={v.id} value={v.id}>{v.fullName}</option>)}
              </select></div>
            <div><label className="f">Valuer 2 {principalPaise > valuer2Threshold ? "*" : "(optional)"}</label>
              <select className="i" value={v2} onChange={e => setV2(e.target.value)}>
                <option value="">— none —</option>{valuers.filter(v => String(v.id) !== String(v1))
                  .map(v => <option key={v.id} value={v.id}>{v.fullName}</option>)}
              </select>
              <div className="hint" style={{ marginTop: 5 }}>
                compulsory above {inr(valuer2Threshold)} · must be a different person</div></div>
          </div>
        </div>)}

      {/* ——— STEP 2 ——— */}
      {step === 2 && (
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14 }}>
            <div><label className="f">Scheme *</label>
              <select className="i" value={schemeId} onChange={e => setSchemeId(e.target.value)}>
                <option value="">— choose —</option>
                {schemes.map(s => <option key={s.id} value={s.id}>{s.code} · fund {s.fundingPct}%</option>)}
              </select></div>
            <div><label className="f">Loan amount ₹ *</label>
              <input className="i mono" value={amount} placeholder="0"
                onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ""))} /></div>
            <div><label className="f">Purpose</label>
              <select className="i" value={purpose} onChange={e => setPurpose(e.target.value)}>
                {[["personal","Personal"],["business","Business"],["agriculture","Agriculture"],
                  ["medical","Medical"],["education","Education"],["other","Other"]]
                  .map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", background: "#faf9f4",
            borderRadius: 12, padding: "12px 16px", marginTop: 16 }}>
            <V k="Net gold" v={g(totals.netMg) + " g"} />
            <V k="Valuation" v={inr(totals.marketPaise)} />
            <V k={`Funding value (${fundingPct}%)`} v={inr(totals.fundingPaise)} brass />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {amount && !pv.ok && <span className="chip bad">{pv.reason}</span>}
            {amount && pv.ok && <span className="chip ok">within funding value</span>}
            {amount && pv.ok && aboveCeiling &&
              <span className="chip warn">above your ceiling of {inr(ceilingPaise)} — will route to Head Office</span>}
            {!vr.ok && <span className="chip bad">{vr.reason}</span>}
          </div>

          <div style={{ marginTop: 20, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
              color: "var(--mut)", marginBottom: 10 }}>People</div>
            <label className="pill"><input type="checkbox" checked={present}
              onChange={e => setPresent(e.target.checked)} /> Borrower present during valuation (RBI)</label>
            {present
              ? <div style={{ marginTop: 14 }}>
                  <PhotoInput kind="presence" label="Borrower photo at the counter *"
                    value={presencePhoto} onChange={setPresencePhoto} /></div>

              : <div style={{ marginTop: 12 }}>
                  <span className="chip warn">borrower absent — a co-borrower is required (Sprint 1B+)</span></div>}

          {/* ——— №2 · co-borrower, from KYC-done customers only ——— */}
          <div style={{ marginTop: 14 }}>
            <button onClick={() => setCob({ ...cob, on: !cob.on })}
              style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid " +
                (cob.on ? "var(--vault)" : "#cfc9ba"), background: cob.on ? "var(--vault)" : "#fff",
                color: cob.on ? "#fff" : "var(--mut)", borderRadius: 10, padding: "9px 13px",
                fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              <span style={{ width: 16, height: 16, borderRadius: 4, border: "2px solid currentColor",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                {cob.on ? "✓" : ""}</span>
              Add a co-borrower</button>
            {cob.on && (
              <div style={{ marginTop: 10 }}>
                {cob.picked ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className="chip ok">✓ {cob.picked.name}
                      {cob.picked.custNo ? " · " + cob.picked.custNo : ""}</span>
                    <button className="btn ghost" style={{ padding: "6px 11px", fontSize: 12 }}
                      onClick={() => setCob({ ...cob, picked: null, q: "", results: [] })}>Change</button>
                  </div>
                ) : (
                  <>
                    <input className="i" value={cob.q} placeholder="Search a KYC-done customer — name, mobile or number…"
                      onChange={async (e) => {
                        const q = e.target.value;
                        setCob({ ...cob, q });
                        if (q.trim().length < 2) { setCob(c => ({ ...c, q, results: [] })); return; }
                        const r = await fetch("/api/search?q=" + encodeURIComponent(q))
                          .then(x => x.json()).catch(() => null);
                        if (r?.ok) setCob(c => c.q === q ? { ...c, results:
                          (r.customers || []).filter(x => x.kyc?.mayLend && !x.isBlacklisted
                            && Number(x.id) !== Number(customer.id)).slice(0, 6) } : c);
                      }} />
                    {cob.q.trim().length >= 2 && (
                      <div style={{ border: "1px solid var(--line)", borderRadius: 10,
                        background: "#fff", marginTop: 6, overflow: "hidden" }}>
                        {cob.results.map(x => (
                          <button key={x.id} onClick={() => setCob({ ...cob,
                              picked: { id: x.id, name: x.fullName, custNo: x.custNo } })}
                            style={{ display: "block", width: "100%", textAlign: "left",
                              padding: "9px 12px", border: 0, borderBottom: "1px solid #f0ede4",
                              background: "#fff", cursor: "pointer", fontSize: 13.5 }}>
                            <b>{x.fullName}</b>
                            <span className="mono" style={{ color: "var(--mut)", fontSize: 11.5,
                              marginLeft: 8 }}>{x.custNo} · {x.mobile}</span></button>))}
                        {cob.results.length === 0 &&
                          <div style={{ padding: "9px 12px", fontSize: 12.5, color: "var(--mut)" }}>
                            No KYC-done customer matches. A co-borrower must already be a customer
                            with full, current KYC — add them from Search first.</div>}
                      </div>)}
                  </>
                )}
                {cob.picked && (
                  <div style={{ marginTop: 8 }}>
                    <PhotoInput kind="coborrower" label="Co-borrower photo at the counter"
                      value={cobPhoto} onChange={setCobPhoto}
                      hint="Taken now, at the counter — same rule as the borrower." />
                  </div>)}
              </div>)}
          </div>

          {/* ——— №12 · pledge documents ——— */}
          <div style={{ marginTop: 14 }}>
            <div className="f">Pledge documents — optional</div>
            <PhotoInput kind="kyc_scan" label="📎 Add a document photo" multiple
              value={docs.map(d => d.file)}
              onChange={(files) => {
                const arr = Array.isArray(files) ? files : files ? [files] : [];
                setDocs(arr.map(f => docs.find(d => d.file.fileId === f.fileId) || { file: f, note: "" }));
              }}
              hint="Declaration, prior receipt, ID copy — anything filed with this pledge." />
            {docs.map((d, i) => (
              <input key={d.file.fileId} className="i" style={{ marginTop: 6 }}
                value={d.note} placeholder={"What is document " + (i + 1) + "?"}
                onChange={e => setDocs(docs.map((x, j) => j === i ? { ...x, note: e.target.value } : x))} />))}
          </div>
          </div>
        </div>)}

      {/* ——— STEP 3 ——— frozen UX: two numbered cards.
           №11 (owner, 28 Aug 2026 — beyond-frozen screen, no disburse step
           exists in the frozen HTML): at "approved" a read-only summary sits
           on top so the disbursing person reviews without editing. */}
      {step === 3 && status === "approved" && (
        <div className="card" style={{ marginBottom: 14, borderLeft: "5px solid var(--vault)" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".08em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 10 }}>
            Review before paying out — read-only</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
            gap: 12, fontSize: 13.5 }}>
            <div><b>Borrower</b><br />{customer.fullName}<br />
              <span className="mono" style={{ color: "var(--mut)", fontSize: 12 }}>{customer.custNo || ""}</span></div>
            {cob.on && cob.picked && (
              <div><b>Co-borrower</b><br />{cob.picked.full_name || cob.picked.fullName || cob.picked.name}</div>)}
            <div><b>Ornaments</b><br />{rows.filter(r => r.itemId).length} item line{rows.filter(r => r.itemId).length === 1 ? "" : "s"} ·
              {" "}{g(totals.netMg)} g net</div>
            <div><b>Funding value</b><br /><span className="mono">{inr(totals.fundingPaise)}</span></div>
            <div><b>Scheme</b><br />{scheme ? `${scheme.code || ""} ${scheme.name || ""}`.trim() : "—"}</div>
            <div><b>Sanctioned amount</b><br /><b className="mono" style={{ fontSize: 16 }}>{inr(principalPaise)}</b></div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--mut)" }}>
            Anything wrong? Use <b>Send back for changes</b> below — the file returns to the
            branch as appraised, with your note, for correction and a fresh approval.</div>
        </div>
      )}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 900 }}>
          {status === "pending_ho" && (
            <div style={{ background: "var(--warn-bg)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 800, color: "var(--warn)" }}>Waiting for Head Office approval</div>
              <div style={{ fontSize: 13.5, color: "var(--warn)", marginTop: 4 }}>
                {inr(principalPaise)} is above this branch's sanction authority. Disbursement unlocks
                when HO approves — the file stays exactly as it is.</div>
              <button className="btn ghost" style={{ marginTop: 12 }} disabled={busy}
                onClick={() => act("withdraw")}>← Withdraw from Head Office and amend</button>
            </div>)}

          {/* 1 · Amount payable */}
          <div className="card">
            <Head n="1" t="Amount payable" />
            <Line k={`Loan sanctioned · ${scheme?.code || ""}`} v={inr(principalPaise)} big />
            <Line k="Valuation / funding value"
              v={`${inr(totals.marketPaise)} / ${inr(totals.fundingPaise)}`} />
            <Line k="Processing fee + GST" v={inr(charge.totalPaise)}
              note="recovered at the first repayment — not deducted here" />
            <div style={{ height: 1, background: "var(--line)", margin: "10px 0" }} />
            <Line k="Net payable to customer" v={inr(payablePaise)} brass bold />
          </div>

          {/* 2 · How it is paid */}
          <div className="card">
            <Head n="2" t="How it is paid" />
            <label className="f">Cash portion · RBI limit under ₹20,000 (Sec 269SS)</label>
            <input className="i mono" style={{ height: 48, fontSize: 19, fontWeight: 800 }}
              value={cash} placeholder="0" disabled={status !== "approved"}
              onChange={e => onCash(e.target.value.replace(/[^\d]/g, ""))} />

            <label className="f" style={{ marginTop: 18 }}>Disburse the bank portion from</label>
            <select className="i" value={slfAcc} disabled={status !== "approved"}
              onChange={e => setSlfAcc(e.target.value)}>
              <option value="">— select our account —</option>
              {slfAccounts.map(a => <option key={a.id} value={a.id}>{a.nickname}</option>)}
            </select>
            <div className="hint" style={{ marginTop: 6 }}>Needed whenever any part goes by bank.</div>

            <label className="f" style={{ marginTop: 18 }}>Customer accounts — tick the ones to pay into</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {banks.map(b => {
                const on = legs[b.id] !== undefined;
                return (
                  <div key={b.id} style={{ background: on ? "#f6faf7" : "#fff",
                    border: "1px solid " + (on ? "#1b4434" : "var(--line)"), borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <button onClick={() => b.payable && toggleBank(b.id)}
                        disabled={!b.payable || status !== "approved"}
                        style={{ display: "flex", alignItems: "center", gap: 9, background: "transparent",
                          border: 0, cursor: b.payable ? "pointer" : "not-allowed", padding: 0,
                          textAlign: "left", flex: "1 1 300px", minWidth: 0 }}>
                        <span style={{ width: 20, height: 20, borderRadius: 5, border: "2px solid #1b4434",
                          background: on ? "#1b4434" : "transparent", color: "#fff", display: "flex",
                          alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 13,
                          flexShrink: 0 }}>{on ? "✓" : ""}</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontWeight: 800, fontSize: 14 }}>{b.bank}</span>
                        </span>
                      </button>
                      <span className={"chip " + (b.payable ? "ok" : "warn")}>
                        {b.payable ? "penny drop ✓" : "not verified — cannot receive"}</span>
                      <input className="i mono" style={{ maxWidth: 140, fontWeight: 800 }} placeholder="0"
                        disabled={!on || status !== "approved"} value={legs[b.id] ?? ""}
                        onChange={e => setLegs({ ...legs, [b.id]: e.target.value.replace(/[^\d]/g, "") })} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                      gap: "8px 16px", marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee8dc" }}>
                      <Cell k="Account no" v={b.accountNo} mono />
                      <Cell k="IFSC" v={b.ifsc} mono />
                      <Cell k="Holder" v={b.holderName} />
                      <Cell k="Type" v={b.acctType || "Savings"} />
                    </div>
                  </div>);
              })}
              {banks.length === 0 && (
                <div style={{ border: "1px dashed var(--line)", borderRadius: 12, padding: 20,
                  textAlign: "center", color: "var(--mut)", fontSize: 13 }}>
                  No bank account on the customer master — add one on the customer record before paying by bank.</div>)}
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", minHeight: 26 }}>
              {plan.problems.map((p, i) => <span key={i} className="chip bad">{p}</span>)}
              {plan.ok && status === "approved" && <span className="chip ok">fully allocated</span>}
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--mut)" }}>
            Ornaments stay in the counter's overnight custody — vault-in appears on tomorrow's home screen.
          </div>
        </div>)}

      {/* save bar */}
      <div style={{ position: "sticky", bottom: 0, marginTop: 16, background: "var(--vault)",
        borderRadius: 14, padding: "12px 16px", display: "flex", justifyContent: "space-between",
        alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ color: "#9fc6b5", fontSize: 13.5, fontWeight: 600 }}>
          {customer.fullName} · <span className="mono">{app.appNo}</span>
          {totals.netMg > 0 && <> · {g(totals.netMg)} g · funding <b style={{ color: "var(--brass-soft)" }}>
            {inr(totals.fundingPaise)}</b></>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={() => act("cancel", {
            reason: "cancelled at counter", narration: "cancelled by operator before disbursement" })}
            disabled={busy}>✕ Cancel application</button>
          {step > 1 && <button className="btn ghost" onClick={() => setStep(s => s - 1)}>← Back</button>}
          {step === 1 && <button className="btn amber" disabled={busy || !totals.netMg || !photos.length || !v1}
            onClick={async () => { await save(); setStep(2); }}>Next: scheme & amount →</button>}
          {step === 2 && <button className="btn amber"
            disabled={busy || !schemeId || !pv.ok || !vr.ok || (present && !presencePhoto)}
            onClick={() => act("submit")}>
            {aboveCeiling ? "Send to Head Office →" : "Approve & continue →"}</button>}
          {sendBack && (
            <div style={{ width: "100%", background: "#faf9f4", border: "1px solid #e2ddd1",
              borderRadius: 12, padding: "12px 14px", marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
                letterSpacing: ".07em", color: "var(--mut)", marginBottom: 6 }}>
                What must the branch fix? — this note travels with the file</div>
              <textarea value={sendBack.note} rows={2}
                onChange={e => setSendBack({ note: e.target.value.slice(0, 300) })}
                placeholder="e.g. co-borrower missing; weight of the second bangle looks wrong"
                style={{ width: "100%", border: "1px solid #cfc9ba", borderRadius: 10,
                  padding: "9px 11px", fontSize: 13.5, boxSizing: "border-box", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
                <button className="btn ghost" onClick={() => setSendBack(null)} disabled={busy}>Cancel</button>
                <button className="btn amber" disabled={busy || sendBack.note.trim().length < 5}
                  onClick={() => act("sendback", { note: sendBack.note.trim() })}>
                  {busy ? "Sending…" : "Send back ↩"}</button>
              </div>
            </div>)}
          {step === 3 && status === "approved" && youApproved && (
            <div style={{ background: "#fdf1d8", border: "1px solid #e8c97a", borderRadius: 12,
              padding: "12px 14px", marginTop: 14, fontSize: 13.5, color: "#a06407",
              fontWeight: 700 }}>
              🔒 You approved this loan — maker ≠ checker: a different person signs in and
              pays it out. It is waiting on the Ready-to-disburse list on their home screen.
            </div>)}
          {step === 3 && status === "approved" && canDisburse && !youApproved && !sendBack &&
            <button className="btn ghost" disabled={busy}
              onClick={() => setSendBack({ note: "" })}>↩ Send back for changes</button>}
          {step === 3 && status === "approved" && canDisburse && !youApproved &&
            <button className="btn green" disabled={busy || !plan.ok}
              onClick={() => act("disburse", { cashPaise: Math.round(Number(cash || 0) * 100),
                bankLegs, slfAccountId: slfAcc ? Number(slfAcc) : null })}>
              {busy ? "…" : `Pay ${inr(payablePaise)} → activate loan`}</button>}
        </div>
      </div>
      {chip && <div style={{ marginTop: 10 }}><span className={"chip " + chip.tone}>{chip.text}</span></div>}

      <style>{`.pill{display:inline-flex;align-items:center;gap:9px;font-size:13.5px;font-weight:700;
        background:#faf9f4;border:1px solid var(--line);padding:9px 13px;border-radius:11px;cursor:pointer}
        .pill input{width:17px;height:17px;accent-color:#1b4434}
        table input.i{padding:8px 10px;font-size:13.5px}`}</style>
    </div>);

  function patch(i, p) { setRows(rows.map((r, j) => j === i ? { ...r, ...p } : r)); }
}

const V = ({ k, v, brass }) => (
  <div>
    <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em",
      textTransform: "uppercase", color: "var(--mut)" }}>{k}</div>
    <div className="mono" style={{ fontSize: 17, fontWeight: 900, color: brass ? "#a8791f" : "inherit" }}>{v}</div>
  </div>);

const Head = ({ n, t }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
    <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--vault)",
      color: "#f6d78a", display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{n}</div>
    <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" }}>{t}</div>
    <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
  </div>);

const Line = ({ k, v, note, brass, bold, big }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline",
    fontSize: bold ? 15 : 14, padding: "3px 0" }}>
    <span style={{ color: bold ? "inherit" : "var(--mut)", fontWeight: bold ? 800 : 400 }}>
      {k}{note && <span style={{ display: "block", fontSize: 11.5, color: "var(--mut)" }}>{note}</span>}</span>
    <b className="mono" style={{ fontSize: big ? 17 : "inherit", color: brass ? "#9a6d13" : "inherit" }}>{v}</b>
  </div>);

const Cell = ({ k, v, mono }) => (
  <div>
    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".09em",
      textTransform: "uppercase", color: "var(--mut)" }}>{k}</div>
    <div className={mono ? "mono" : ""} style={{ fontSize: 13, fontWeight: mono ? 700 : 400 }}>{v}</div>
  </div>);
