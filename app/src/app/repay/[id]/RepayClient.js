"use client";
import { useEffect, useState } from "react";

const inr = (r) => "₹" + Math.round(Number(r || 0)).toLocaleString("en-IN");
const dmy = (d) => { const [y, m, dd] = String(d).split("-"); return `${dd}-${m}-${y}`; };

export default function RepayClient({ loanId }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState("");
  const [utr, setUtr] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [closingIntent, setClosingIntent] = useState(false);

  const load = () => fetch(`/api/loans/${loanId}/dues`).then(r => r.json())
    .then(r => r.ok ? setD(r) : setErr(r.reason))
    .catch(() => setErr("Could not price this loan"));
  useEffect(() => { load(); }, [loanId]);

  if (err && !d) return <div className="card"><span className="chip bad">{err}</span></div>;
  if (!d) return <div className="card" style={{ color: "var(--mut)" }}>Loading…</div>;

  if (done) {
    const paidR = Number(amt || 0);   // amtN is declared further down — using it here crashes
    const wa = `नमस्कार ${d.loan.customerName.split(" ")[0]} जी, कर्ज ${d.loan.loanNo} वर ` +
      `${inr(paidR)} जमा झाले. व्याज ${inr(done.appropriation.interest)} · ` +
      `मुद्दल ${inr(done.appropriation.principal)} · शिल्लक ${inr(done.principalAfter)}. ` +
      `धन्यवाद — S Lunawat Finance`;
    return (
    <div style={{ maxWidth: 620, margin: "0 auto" }}>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #slf-receipt, #slf-receipt * { visibility: visible !important; }
        #slf-receipt { position: fixed; left: 0; top: 0; width: 100%; border: none; }
      }`}</style>
      <div style={{ textAlign: "center", padding: "10px 0" }}>
        <div style={{ fontSize: 46, lineHeight: 1, color: "#1e7a4f" }}>✓</div>
        <h1 style={{ fontSize: 23, fontWeight: 900, margin: "8px 0 2px" }}>Receipt {done.receiptNo}</h1>
        <p style={{ color: "var(--mut)", fontSize: 13, margin: "0 0 8px" }}>पावती {done.receiptNo}</p>
        {done.closes && (
          <div style={{ margin: "0 0 10px" }}>
            <span className="chip ok">LOAN CLOSED — 7-working-day gold release timer started</span>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ fontSize: 14, lineHeight: 1.8, color: "var(--mut)" }}>
          {done.appropriation.charges > 0 && <>To charges <b className="mono">{inr(done.appropriation.charges)}</b><br /></>}
          {done.appropriation.penal > 0 && <>To penal <b className="mono">{inr(done.appropriation.penal)}</b><br /></>}
          To interest <b className="mono">{inr(done.appropriation.interest)}</b><br />
          To principal <b className="mono">{inr(done.appropriation.principal)}</b><br />
          Principal after this receipt <b className="mono">{inr(done.principalAfter)}</b>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
          letterSpacing: ".07em", color: "var(--mut)", marginBottom: 8 }}>
          WhatsApp (Marathi) — copy and send from the branch phone</div>
        <div style={{ fontSize: 14, lineHeight: 1.6, background: "#e2f2e9",
          border: "1px solid #9bcfb3", borderRadius: 12, padding: "10px 13px" }}>{wa}</div>
        <button className="btn ghost" style={{ marginTop: 10 }}
          onClick={() => navigator.clipboard?.writeText(wa)}>Copy message</button>
      </div>

      {/* ——— what the printer prints ——— */}
      <div id="slf-receipt" style={{ background: "#fff", border: "1px solid #e2ddd1",
        borderRadius: 12, padding: "18px 22px", marginTop: 12,
        fontFamily: "ui-monospace,monospace", fontSize: 13, lineHeight: 1.7 }}>
        <div style={{ textAlign: "center", fontWeight: 900, fontSize: 15 }}>S LUNAWAT FINANCE</div>
        <div style={{ textAlign: "center", fontSize: 11.5 }}>Gold Loan Division</div>
        <div style={{ textAlign: "center", fontWeight: 800, margin: "8px 0" }}>
          PAYMENT RECEIPT · पावती</div>
        <div>Receipt No: {done.receiptNo}</div>
        <div>Date: {dmy(d.today)}</div>
        <div>Loan No: {d.loan.loanNo}</div>
        <div>Customer: {d.loan.customerName}</div>
        <div style={{ fontWeight: 900, margin: "6px 0" }}>Amount received: {inr(paidR)}</div>
        {done.appropriation.charges > 0 && <div>&nbsp;&nbsp;to charges: {inr(done.appropriation.charges)}</div>}
        {done.appropriation.penal > 0 && <div>&nbsp;&nbsp;to penal: {inr(done.appropriation.penal)}</div>}
        <div>&nbsp;&nbsp;to interest: {inr(done.appropriation.interest)}</div>
        <div>&nbsp;&nbsp;to principal: {inr(done.appropriation.principal)}</div>
        <div>Balance principal: {inr(done.principalAfter)}</div>
        {done.closes && <div style={{ fontWeight: 900, marginTop: 6 }}>*** LOAN CLOSED ***</div>}
        {paidBy.trim() && <div>Paid by: {paidBy.trim()}</div>}
        <div style={{ marginTop: 8, fontSize: 11.5 }}>Received by: {mode.toUpperCase()}{utr ? " · " + utr : ""}</div>
        <div style={{ textAlign: "center", marginTop: 8 }}>Thank you — S Lunawat Finance</div>
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "center" }}>
        <button className="btn" onClick={() => window.print()}>🖨 Print receipt</button>
        <a href="/home" className="btn ghost" style={{ textDecoration: "none" }}>Back to home</a>
      </div>
    </div>
  ); }

  // The engine prices a running loan and a closing loan differently: the
  // 15-day minimum and the penal grace forgiveness apply only at closure.
  const view = closingIntent ? d.closing : d.running;
  const settleR = d.closing.settlement;
  const amtN = Number(amt || 0);

  const chargesDue = view.charges.due;
  const penalDue = view.penal.due;
  const interestDue = view.interest.due;
  const toChg = Math.min(amtN, chargesDue);
  const toPen = Math.min(Math.max(amtN - toChg, 0), penalDue);
  const toInt = Math.min(Math.max(amtN - toChg - toPen, 0), interestDue);
  const toPri = Math.max(0, Math.min(amtN - toChg - toPen - toInt, view.principal));
  const bal = view.principal - toPri;

  const chips = [];
  if (amtN > settleR) chips.push(["bad", `more than the total due ${inr(settleR)} — check the amount`]);
  else if (amtN > 0 && amtN < 100) chips.push(["bad", "minimum payment is ₹100"]);
  else if (amtN > 0 && amtN % 10 !== 0 && amtN !== settleR)
    chips.push(["bad", `multiples of ₹10 only — nearest ${inr(Math.ceil(amtN / 10) * 10)}`]);
  else if (amtN > 0 && toChg < chargesDue)
    chips.push(["warn", `${inr(chargesDue - toChg)} charges still due — interest is paid only after charges clear`]);
  else if (amtN > 0 && bal === 0 && closingIntent)
    chips.push(["ok", "this closes the loan → gold release timer starts"]);
  else if (amtN > 0 && toInt < interestDue) chips.push(["warn", "partial interest — balance interest stays due"]);
  if (!mode && amtN > 0) chips.push(["warn", "select the mode of payment"]);
  if (mode && mode !== "cash" && !utr.trim() && amtN > 0)
    chips.push(["warn", "enter the UTR or reference"]);

  const bad = amtN <= 0 || amtN > settleR || amtN < 100 ||
    (amtN % 10 !== 0 && amtN !== settleR) || !mode ||
    (mode !== "cash" && !utr.trim());

  const quickLabel = chargesDue > 0
    ? `Charges + interest ${inr(chargesDue + penalDue + interestDue)}`
    : `Interest only ${inr(penalDue + interestDue)}`;

  const modeHint = mode === "cash"
    ? "Cash from one customer capped at ₹2,00,000 per day (Sec 269ST) — enforced."
    : mode ? "Enter the UTR or reference — the receipt cannot be saved without it."
           : "Ask the customer how they are paying — nothing is pre-selected.";

  const td = { padding: "10px 12px", borderBottom: "1px solid #efece3", fontSize: 13.5 };
  const tdR = { ...td, textAlign: "right", fontFamily: "ui-monospace,monospace", fontWeight: 700 };

  async function take() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/loans/${loanId}/receipt`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paidBy: paidBy.trim() || null, amountPaise: Math.round(amtN * 100), mode,
        utr: utr.trim(), closing: closingIntent }) }).then(r => r.json())
      .catch(() => ({ ok: false, reason: "The payment could not be sent" }));
    setBusy(false);
    if (!r.ok) { setErr(r.reason); load(); } else setDone(r);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <a href="/home" style={{ color: "var(--mut)", fontSize: 13, fontWeight: 700,
        textDecoration: "none" }}>← home</a>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0 0" }}>
        {d.loan.ornamentPhotoUrl &&
          <img src={d.loan.ornamentPhotoUrl} alt="pledged ornaments"
            style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover",
              border: "1px solid var(--line)" }} />}
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0 }}>
          Collect payment — {d.loan.customerName}</h1>
      </div>
      {d.loan.coborrowerName &&
        <div style={{ margin: "6px 0 0" }}>
          <span className="chip mut">co-borrower: {d.loan.coborrowerName}
            {d.loan.coborrowerCustNo ? " · " + d.loan.coborrowerCustNo : ""}</span></div>}
      <p className="mono" style={{ color: "var(--mut)", fontSize: 13, margin: "0 0 18px" }}>
        {d.loan.loanNo} · {d.loan.schemeCode} · day {view.cycleDays} · as on {dmy(d.today)}
        {" · "}<a href={`/addcharge/${loanId}`} style={{ color: "var(--vault)", fontWeight: 800 }}>+ add charge</a></p>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ background: "#f0eee6" }}>
            <th style={{ ...td, textAlign: "left", fontSize: 11, textTransform: "uppercase",
              letterSpacing: ".08em" }}>Interest working — shown to the customer</th>
            <th style={{ ...td, fontSize: 11, textTransform: "uppercase" }}>Days</th>
            <th style={{ ...td, textAlign: "right", fontSize: 11, textTransform: "uppercase" }}>Amount</th>
          </tr></thead>
          <tbody>
            {/* Only what is still owing appears. A settled line is not shown. */}
            {interestDue > 0 && (
              <tr>
                <td style={td}>{view.interest.workLine}</td>
                <td style={{ ...td, textAlign: "center" }}>{view.cycleDays}</td>
                <td style={tdR}>{inr(interestDue)}</td>
              </tr>
            )}
            {penalDue > 0 && (
              <tr>
                <td style={{ ...td, color: "#b03426" }}>
                  <b>Penal interest</b> · overdue since {dmy(view.penal.graceTill)}</td>
                <td style={{ ...td, textAlign: "center" }}>{view.penal.days}</td>
                <td style={{ ...tdR, color: "#b03426" }}>{inr(penalDue)}</td>
              </tr>
            )}
            {d.charges.filter(c => c.balancePaise > 0).map(c => (
              <tr key={c.id}>
                <td style={td}><b>Charge</b> · {c.name} — {c.narration}</td>
                <td style={{ ...td, textAlign: "center", fontSize: 12 }}>{dmy(c.addedOn)}</td>
                <td style={tdR}>{inr(c.balancePaise / 100)}</td>
              </tr>
            ))}
            {view.principal > 0 && (
              <tr>
                <td style={td}>Principal outstanding</td>
                <td style={td}></td>
                <td style={tdR}>{inr(view.principal)}</td>
              </tr>
            )}
            <tr style={{ background: "#f0eee6" }}>
              <td style={{ ...td, fontWeight: 900 }}>Full settlement today</td>
              <td style={td}></td>
              <td style={{ ...tdR, fontWeight: 900 }}>{inr(settleR)}</td>
            </tr>
          </tbody>
        </table>
        {view.interest.minApplied && (
          <div style={{ padding: "10px 14px", background: "#fdf1d8" }}>
            <span className="chip warn">
              minimum {view.interest.minDays}-day interest applied — actual age day {view.cycleDays}</span>
            <div style={{ fontSize: 12.5, color: "#a06407", marginTop: 6 }}>
              This payment carries the customer to {dmy(view.interest.minCoversUpto)} —
              no interest is charged again for those days.
            </div>
          </div>
        )}
        {view.penal.inGraceWindow && (
          <div style={{ padding: "10px 14px", background: "#e2f2e9" }}>
            <span className="chip ok">within the grace window — penal forgiven if settled by {dmy(view.penal.graceTill)}</span>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <button className="btn ghost" onClick={() => {
            setClosingIntent(false);
            setAmt(String(d.running.charges.due + d.running.penal.due + d.running.interest.due)); }}>
            {quickLabel}</button>
          <button className="btn ghost" onClick={() => {
            setClosingIntent(true); setAmt(String(d.closing.settlement)); }}>
            Close loan {inr(d.closing.settlement)}</button>
        </div>

        <label className="f">Amount received</label>
        <input value={amt} inputMode="numeric"
          onChange={e => setAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
          style={{ width: "100%", maxWidth: 280, padding: "12px 14px", borderRadius: 10,
            border: "1px solid #cfc9ba", fontSize: 20, fontWeight: 800,
            fontFamily: "ui-monospace,monospace" }} />
        <div className="hint">Minimum ₹100 · multiples of ₹10 only</div>

        <label className="f" style={{ marginTop: 14 }}>Mode</label>
        <select value={mode} onChange={e => { setMode(e.target.value); setUtr(""); }}
          style={{ padding: "10px 12px", borderRadius: 10, fontSize: 15, background: "#fff",
            minWidth: 240, border: "1px solid " + (mode ? "#cfc9ba" : "var(--brass)") }}>
          <option value="">— select mode —</option>
          <option value="upi">UPI</option>
          <option value="cash">Cash</option>
          <option value="bank">Bank transfer</option>
        </select>
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".09em",
            textTransform: "uppercase", color: "var(--mut)", marginBottom: 5 }}>
            Paid by — who handed over the money</div>
          <input value={paidBy} onChange={e => setPaidBy(e.target.value.slice(0, 80))}
            placeholder="Leave blank if the borrower paid"
            style={{ width: "100%", border: "1px solid #cfc9ba", borderRadius: 10,
              padding: "0 11px", height: 40, fontSize: 13.5, boxSizing: "border-box" }} />
        </div>
        <div className="hint">{modeHint}</div>

        {mode && mode !== "cash" && (
          <div style={{ marginTop: 14 }}>
            <label className="f">UTR / reference</label>
            <input value={utr} onChange={e => setUtr(e.target.value)}
              placeholder="e.g. N0272026072700123"
              style={{ width: "100%", maxWidth: 360, padding: "10px 12px", borderRadius: 10,
                border: "1px solid #cfc9ba", fontSize: 15, fontFamily: "ui-monospace,monospace" }} />
          </div>
        )}

        <div style={{ marginTop: 18, background: "#faf9f4", border: "1px solid #e2ddd1",
          borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase",
            letterSpacing: ".07em", color: "var(--mut)", marginBottom: 8 }}>
            Appropriation · charges → penal → interest → principal</div>
          {chargesDue > 0 && (
            <Row label={<>To charges <span style={{ color: "var(--mut)", fontWeight: 400 }}>(always first)</span></>}
              value={inr(toChg)} />)}
          {penalDue > 0 && <Row label="To penal" value={inr(toPen)} />}
          <Row label="To interest" value={inr(toInt)} />
          <Row label="To principal" value={inr(toPri)} />
          <Row label="Principal after this receipt" value={inr(bal)} strong />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {chips.map(([tone, text], i) => <span key={i} className={"chip " + tone}>{text}</span>)}
          </div>
        </div>

        {err && <div style={{ marginTop: 12 }}><span className="chip bad">{err}</span></div>}

        <div style={{ marginTop: 18 }}>
          <button className="btn" disabled={bad || busy || !d.canCollect}
            style={{ opacity: bad || busy || !d.canCollect ? .4 : 1,
              cursor: bad || busy ? "not-allowed" : "pointer" }}
            onClick={take}>
            {busy ? "Saving…"
              : bal === 0 && amtN > 0 && closingIntent
                ? `Receive ${inr(amtN)} → close loan & start release`
                : `Receive ${inr(amtN)} → print receipt`}
          </button>
          {!d.canCollect && <div style={{ marginTop: 8 }}>
            <span className="chip warn">you may view but not receive payments</span></div>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0",
      fontSize: 14, fontWeight: strong ? 800 : 400 }}>
      <span>{label}</span>
      <b className="mono">{value}</b>
    </div>
  );
}
