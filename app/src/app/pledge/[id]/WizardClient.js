"use client";
import { useState, useMemo } from "react";
import PhotoInput from "@/components/PhotoInput.js";
import { ornamentValue, appraisalTotals, validPrincipal, valuerRule,
         disbursementPlan, docCharge, inr } from "@/lib/valuation.js";

const g = (mg) => (Number(mg || 0) / 1000).toFixed(3);
const mg = (grams) => Math.round(Number(grams || 0) * 1000);

export default function WizardClient({ app, customer, items, purities, schemes, itemMaster, valuers,
                                       banks, slfAccounts, ceilingPaise, base24k, funding24k,
                                       valuer2Threshold, canDisburse }) {
  const [step, setStep] = useState(app.status === "approved" ? 3 : app.status === "pending_ho" ? 2 : 1);
  const [rows, setRows] = useState(items.length ? items : [newRow()]);
  const [photos, setPhotos] = useState(app.ornamentPhotos || []);
  const [schemeId, setSchemeId] = useState(app.schemeVersionId || "");
  const [amount, setAmount] = useState(app.requestedPaise ? String(app.requestedPaise / 100) : "");
  const [purpose, setPurpose] = useState(app.purpose || "personal");
  const [present, setPresent] = useState(app.borrowerPresent ?? true);
  const [presencePhoto, setPresencePhoto] = useState(null);
  const [v1, setV1] = useState(app.valuer1Id || "");
  const [v2, setV2] = useState(app.valuer2Id || "");
  const [cash, setCash] = useState("");
  const [legs, setLegs] = useState({});
  const [slfAcc, setSlfAcc] = useState(slfAccounts[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [chip, setChip] = useState(null);
  const [status, setStatus] = useState(app.status);
  const [done, setDone] = useState(null);

  function newRow() { return { itemId: "", qty: 1, gross: "", stone: "0", purityId: "", narration: "" }; }
  const scheme = schemes.find(s => String(s.id) === String(schemeId));
  const fundingPct = Number(scheme?.fundingPct || 0);

  const priced = useMemo(() => rows.map(r => {
    const p = purities.find(x => String(x.id) === String(r.purityId));
    if (!r.itemId || !r.gross || !p) return { ...r, netMg: 0, marketPaise: 0, fundingPaise: 0 };
    const v = ornamentValue({ grossMg: mg(r.gross), stoneMg: mg(r.stone), purityPct: Number(p.purityPct),
      base24kPaise: base24k, funding24kPaise: funding24k, fundingPct });
    return { ...r, ...v, grossMg: mg(r.gross), stoneMg: mg(r.stone) };
  }), [rows, purities, fundingPct, base24k, funding24k]);

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
  const plan = disbursementPlan({ principalPaise, chargesPaise: charge.totalPaise,
    cashPaise: Math.round(Number(cash || 0) * 100), bankLegs });

  async function save(extra = {}) {
    const body = {
      items: priced.filter(r => r.itemId && r.grossMg > 0).map(r => ({
        itemId: Number(r.itemId), qty: Number(r.qty || 1), grossMg: r.grossMg,
        stoneMg: r.stoneMg, purityId: Number(r.purityId), narration: r.narration })),
      ornamentPhotoIds: photos.map(p => p.fileId),
      schemeVersionId: schemeId ? Number(schemeId) : null,
      requestedPaise: principalPaise || null, purpose,
      borrowerPresent: present, presencePhotoId: presencePhoto?.fileId ?? null,
      valuer1Id: v1 ? Number(v1) : null, valuer2Id: v2 ? Number(v2) : null, ...extra };
    const r = await fetch(`/api/applications/${app.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then(r => r.json());
    return r;
  }

  async function act(action, extra = {}) {
    setBusy(true); setChip(null);
    if (action !== "cancel") { const s = await save(); if (!s.ok) { setBusy(false); setChip({ tone: "bad", text: s.reason }); return; } }
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
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[[1, "Appraisal"], [2, "Scheme, amount & people"], [3, "Disbursement"]].map(([n, label]) => (
          <button key={n} onClick={() => setStep(n)} disabled={n > 1 && !totals.netMg}
            style={{ border: 0, padding: "9px 16px", borderRadius: 11, fontWeight: 800, fontSize: 13.5,
              cursor: "pointer", background: step === n ? "var(--vault)" : "#eceadf",
              color: step === n ? "#fff" : "var(--mut)" }}>{n} · {label}</button>))}
      </div>

      {/* ——— STEP 1 ——— */}
      {step === 1 && (
        <div className="card">
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 860 }}>
              <thead><tr style={{ color: "var(--mut)", fontSize: 10.5, textAlign: "left" }}>
                {["ITEM","QTY","GROSS g","STONE g","NET g","PURITY","MARKET VALUE","FUNDING VALUE",""]
                  .map(h => <th key={h} style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {priced.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 6, minWidth: 155 }} className="grid-cell">
                      <select className="i" value={r.itemId} onChange={e => patch(i, { itemId: e.target.value })}>
                        <option value="">— item —</option>
                        {itemMaster.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
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
                        {purities.map(p => <option key={p.id} value={p.id}>{p.karat}</option>)}
                      </select></td>
                    <td style={{ padding: 6 }} className="mono">{r.marketPaise ? inr(r.marketPaise) : "—"}</td>
                    <td style={{ padding: 6, color: "#a8791f", fontWeight: 800 }} className="mono">
                      {r.fundingPaise ? inr(r.fundingPaise) : "—"}</td>
                    <td style={{ padding: 6 }}>{rows.length > 1 &&
                      <button className="btn ghost" style={{ padding: "6px 9px", fontSize: 12 }}
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>}</td>
                  </tr>))}
                <tr style={{ borderTop: "2px solid var(--ink)", fontWeight: 800 }}>
                  <td style={{ padding: "10px 8px" }}>{totals.items} item(s)</td>
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
          </div>
        </div>)}

      {/* ——— STEP 3 ——— */}
      {step === 3 && (
        <div className="card">
          {status === "pending_ho" && (
            <div style={{ background: "var(--warn-bg)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontWeight: 800, color: "var(--warn)" }}>Waiting for Head Office approval</div>
              <div style={{ fontSize: 13.5, color: "var(--warn)", marginTop: 4 }}>
                {inr(principalPaise)} is above this branch's sanction authority. Disbursement unlocks
                when HO approves — the file stays exactly as it is.</div>
            </div>)}

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", background: "#faf9f4",
            borderRadius: 12, padding: "12px 16px" }}>
            <V k="Sanctioned" v={inr(principalPaise)} />
            <V k="Processing charge" v={inr(charge.totalPaise)} />
            <V k="Payable to customer" v={inr(principalPaise - charge.totalPaise)} brass />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
            gap: 14, marginTop: 16 }}>
            <div><label className="f">Cash ₹ (must stay under ₹20,000)</label>
              <input className="i mono" value={cash} placeholder="0"
                disabled={status !== "approved"}
                onChange={e => setCash(e.target.value.replace(/[^\d]/g, ""))} />
              <div className="hint" style={{ marginTop: 5 }}>Sec 269SS · the balance must go to a bank account</div></div>
            <div><label className="f">Pay from</label>
              <select className="i" value={slfAcc} disabled={status !== "approved"}
                onChange={e => setSlfAcc(e.target.value)}>
                {slfAccounts.map(a => <option key={a.id} value={a.id}>{a.nickname}</option>)}</select></div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
              color: "var(--mut)", marginBottom: 10 }}>Customer's bank accounts</div>
            {banks.length === 0 && <div style={{ color: "var(--mut)", fontSize: 14 }}>
              None on file — add one from the customer page, or pay cash under ₹20,000.</div>}
            {banks.map(b => (
              <div key={b.id} style={{ display: "flex", justifyContent: "space-between", gap: 12,
                alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{b.bank}</div>
                  <div className="mono" style={{ color: "var(--mut)", fontSize: 12.5 }}>
                    ····{String(b.accountNo).slice(-4)} · {b.ifsc} · {b.holderName}</div>
                </div>
                {b.payable
                  ? <input className="i mono" style={{ maxWidth: 160 }} placeholder="amount ₹"
                      disabled={status !== "approved"} value={legs[b.id] || ""}
                      onChange={e => setLegs({ ...legs, [b.id]: e.target.value.replace(/[^\d]/g, "") })} />
                  : <span className="chip bad">unverified — cannot receive money</span>}
              </div>))}
          </div>

          <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {plan.problems.map((p, i) => <span key={i} className="chip bad">{p}</span>)}
            {plan.ok && status === "approved" && <span className="chip ok">fully allocated</span>}
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
          {step === 3 && status === "approved" && canDisburse &&
            <button className="btn green" disabled={busy || !plan.ok}
              onClick={() => act("disburse", { cashPaise: Math.round(Number(cash || 0) * 100),
                bankLegs, slfAccountId: slfAcc ? Number(slfAcc) : null })}>
              {busy ? "…" : `Pay ${inr(principalPaise - charge.totalPaise)} → activate loan`}</button>}
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
