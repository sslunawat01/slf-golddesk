/*
 * FROZEN at engine 1.2.0 (15 Oct 2026). The Maraekat import was priced under that
 * engine and is complete on prod; these tools keep pointing at the frozen copy so
 * their figures stay reproducible. They must NOT be used to import again under
 * engine 1.3.0 without rework. See SLF-DECISIONS.md §E37.
 */
/**
 * Tests: the pure planning half of the Maraekat import (scripts/lib-maraekat.mjs).
 * No database. Run: node scripts/test-maraekat.mjs
 */
import { planLoan, pairRenewals, backComputeItem, fixPrincipal, payMode, accountKey,
         rateOn, INFERRED, INFERRED_COMMON } from "./lib-maraekat.mjs";
import { schemeFromRow, replayLoan } from "./loanstate-1.2.0-frozen.js";
import { dues } from "./engine-1.2.0-frozen.js";

let pass = 0, fail = 0;
const t = (c, l) => { if (c) pass++; else { fail++; console.log("FAIL " + l); } };

const simple18 = schemeFromRow({ ...INFERRED_COMMON, calc_method: "simple", interest_pct: 18 }, [], "T18");
const loan = (o = {}) => ({ loanNo: "T1", date: "2025-01-01", status: "Close", amountPaise: 1000000,
  eligiblePaise: 1100000, legs: [{ acct: "Cash", paise: 1000000 }], ...o });
const rc = (no, date, paise, o = {}) => ({ no, date, paise, paymode: "CASH", bank: "Cash",
  principalPaise: 0, interestPaise: paise, chargesPaise: 0, isClosed: null, ...o });
const validStored = (p) => p.receipts.every(r => r.isExact || (r.paise >= 10000 && r.paise % 1000 === 0));

// —— mappings ——
t(payMode("CASH") === "cash" && payMode("PG upi") === "upi" && payMode("PGS upi") === "upi", "paymode cash/upi");
t(payMode("NET BANKING") === "bank" && payMode("PG card") === "bank" && payMode("PG netbanking") === "bank", "paymode bank");
t(accountKey("Cash") === null && accountKey("ReEntry Bank") === "ReEntry Bank", "account cash/reentry");
t(accountKey("Bandhan Bank, Nasikroad") === "Bandhan Bank" && accountKey("B3 HDFC") === "B3 HDFC", "account bandhan/b3");
t(accountKey("Payment Gateway") === "Payment Gateway", "account PG");
t(rateOn("2024-10-29") === 785000 && rateOn("2026-09-01") === 1230000, "rate table + hold");

// —— inferred schemes all valid for the engine ——
for (const [code, s] of Object.entries(INFERRED)) {
  let okS = true;
  try { schemeFromRow({ ...INFERRED_COMMON, calc_method: s.simple ? "simple" : "slab", interest_pct: s.simple }, s.slabs || [], code); }
  catch { okS = false; }
  t(okS, `inferred scheme ${code} passes engine validation`);
}

// —— principal to ₹100 ——
const fx = fixPrincipal(1234550, [{ acct: "Cash", paise: 1000000 }, { acct: "B3 HDFC", paise: 234550 }]);
t(fx.principal === 1230000 && fx.diff === 4550, "₹12,345.50 → principal ₹12,300 (R-J ₹100 steps)");
t(fx.legs.find(l => l.acct === "Cash").paise === 995450 && fx.legs.reduce((a, l) => a + l.paise, 0) === 1230000,
  "largest leg absorbs the difference; legs sum to principal");

// —— closing receipt becomes the exact settlement ——
{
  const p = planLoan({ loan: loan(), scheme: simple18, receipts: [rc("R1", "2025-03-01", 25000), rc("R2", "2025-06-01", 1000000)] });
  const st = { ...p.state };
  t(p.state.closed && p.closedOn === "2025-06-01", "Close loan ends closed on its last receipt date");
  t(p.receipts[1].isExact && p.receipts[1].closes, "closing receipt is exact settlement and closes");
  t(p.notes.some(n => n.kind === "closing_amount_differs"), "closing difference reported");
  t(validStored(p), "every stored amount passes R-J / receipt CHECK");
  // replay as the screens do → same end state
  const re = replayLoan({ principalPaise: p.principal, disbursedAt: "2025-01-01", scheme: simple18,
    receipts: p.receipts.map(r => ({ business_date: r.date, amount_paise: r.paise, closes_loan: r.closes })) });
  t(re.closed === st.closed && re.principal === st.principal, "stored receipts replay to the same state");
}
// —— under ₹100 carried into the next receipt ——
{
  const p = planLoan({ loan: loan({ status: "Approve" }), scheme: simple18,
    receipts: [rc("R1", "2025-02-01", 9000), rc("R2", "2025-03-01", 20000)] });
  t(p.receipts.length === 1 && p.receipts[0].paise === 29000 && p.receipts[0].merged?.[0] === "R1",
    "₹90 carried into the next receipt (₹290 stored, merged R1)");
  t(p.notes.some(n => n.kind === "receipt_carried") && !p.state.closed, "carry reported; loan still running");
}
// —— not in ₹10 steps → rounded, remainder carried ——
{
  const p = planLoan({ loan: loan({ status: "Approve" }), scheme: simple18,
    receipts: [rc("R1", "2025-02-01", 13400), rc("R2", "2025-03-01", 10000)] });
  t(p.receipts[0].paise === 13000 && p.receipts[1].paise === 10000 && p.notes.some(n => n.kind === "carry_dropped"),
    "₹134 → ₹130; the ₹4 joins the next (₹104 → ₹100), the last ₹4 is reported as dropped");
  t(validStored(p) && p.notes.some(n => n.kind === "receipt_rounded"), "rounding reported; stored amounts valid");
}
// —— carry with no later receipt is reported as dropped ——
{
  const p = planLoan({ loan: loan({ status: "Approve" }), scheme: simple18, receipts: [rc("R1", "2025-02-01", 5000)] });
  t(p.receipts.length === 0 && p.notes.some(n => n.kind === "carry_dropped"), "lonely ₹50 reported as dropped");
}
// —— several receipts on the closing day: the last becomes the remainder ——
{
  const p = planLoan({ loan: loan(), scheme: simple18,
    receipts: [rc("R1", "2025-06-01", 500000), rc("R2", "2025-06-01", 600000)] });
  t(p.receipts.length === 2 && p.receipts[0].paise === 500000 && p.receipts[1].closes && p.state.closed,
    "closing-day split: first kept as paid, last is the settlement remainder");
}
{
  const p = planLoan({ loan: loan(), scheme: simple18,
    receipts: [rc("R1", "2025-06-01", 1100000), rc("R2", "2025-06-01", 8000)] });
  t(p.receipts.length === 1 && p.receipts[0].closes && p.notes.some(n => n.kind === "receipt_merged_into_closing"),
    "closing-day overpayment: first closes, later same-day receipt merged");
}
// —— a running loan whose receipt pays everything ——
{
  const p = planLoan({ loan: loan({ status: "Approve" }), scheme: simple18,
    receipts: [rc("R1", "2025-02-01", 2000000), rc("R2", "2025-03-01", 10000)] });
  t(p.state.closed && p.notes.some(n => n.kind === "closed_early") && p.notes.some(n => n.kind === "receipt_skipped_after_close"),
    "early full settlement closes it; later receipt skipped and reported");
}
// —— Maraekat charges become a charge raised that day, settled first ——
{
  const p = planLoan({ loan: loan({ status: "Approve" }), scheme: simple18,
    receipts: [rc("R1", "2025-02-01", 30000, { chargesPaise: 11800 })] });
  t(p.charges.length === 1 && p.charges[0].paise === 11800 && p.charges[0].date === "2025-02-01", "charge raised on the receipt date");
  const ch = p.receipts[0].rows.filter(r => r.bucket === "charge");
  t(ch.length === 1 && ch[0].loanChargeId === 0 && ch[0].amountPaise === 11800, "appropriation pays the charge first (exact)");
  t(p.receipts[0].rows.some(r => r.bucket === "charge_rounding" && r.amountPaise === 200), "₹2 charge round-up → rounding income");
}
// —— two receipts on one day, the charge on the SECOND: raised before the first (replay order) ——
{
  const p = planLoan({ loan: loan({ status: "Approve" }), scheme: simple18,
    receipts: [rc("R1", "2025-02-01", 10000), rc("R2", "2025-02-01", 30000, { chargesPaise: 11800 })] });
  t(p.charges.length === 1 && p.charges[0].receipt === "R2", "the charge belongs to R2");
  t(p.receipts[0].rows.some(r => r.bucket === "charge") && !p.receipts[1].rows.some(r => r.bucket === "charge" && r.amountPaise === 11800),
    "R1 (earlier the same day) pays the charge first — as buildEvents will replay it");
}

// —— engine's own figures agree with dues() after the plan ——
{
  const p = planLoan({ loan: loan({ status: "Approve" }), scheme: simple18, receipts: [rc("R1", "2025-02-01", 20000)] });
  const d = dues(simple18, p.state, "2025-03-01");
  t(d._paise.settlement > p.state.principal, "running loan still owes interest after the plan");
}
// —— renewal pairing is 1:1, closest amounts first ——
{
  const pairs = pairRenewals(
    [{ loanNo: "O1", cust: "C", date: "2025-05-01", paise: 50000 }, { loanNo: "O2", cust: "C", date: "2025-05-01", paise: 30000 }],
    [{ loanNo: "N1", cust: "C", date: "2025-05-01", paise: 31000 }]);
  t(pairs.length === 1 && pairs[0].oldLoanNo === "O2" && pairs[0].newLoanNo === "N1", "closest old loan pairs with the new one");
  const none = pairRenewals([{ loanNo: "O1", cust: "C", date: "2025-05-01", paise: 1 }],
                            [{ loanNo: "N1", cust: "D", date: "2025-05-01", paise: 1 }]);
  t(none.length === 0, "different customer never pairs");
  const many = pairRenewals(
    [{ loanNo: "O1", cust: "C", date: "D", paise: 100 }, { loanNo: "O2", cust: "C", date: "D", paise: 200 }],
    [{ loanNo: "N1", cust: "C", date: "D", paise: 200 }, { loanNo: "N2", cust: "C", date: "D", paise: 100 }]);
  t(many.length === 2 && new Set(many.map(p => p.oldLoanNo)).size === 2 && new Set(many.map(p => p.newLoanNo)).size === 2,
    "2 old × 2 new → two unique pairs");
}
// —— ornament weight back-computed ——
{
  const it = backComputeItem({ lendablePaise: 6220000, base24kPaise: 785000, fundingPct: 80, purityPct: 92 });
  t(it.fundingPaise >= 6220000 && it.fundingPaise - 6220000 <= 20000 && it.fundingPaise % 10000 === 0,
    `funding value covers the eligible amount (₹${it.fundingPaise / 100})`);
  t(it.marketPaise > it.fundingPaise && it.marketPaise % 10000 === 0 && it.grossMg > 0, "market above funding, ₹100 steps");
  t(backComputeItem({ lendablePaise: 0, base24kPaise: 785000, fundingPct: 80 }) === null, "no eligible amount → no item");
  t(backComputeItem({ lendablePaise: 300000, base24kPaise: 1230000, fundingPct: 75 }).itemKey === "ring", "small weight → ring");
}

console.log(`\nmaraekat plan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
