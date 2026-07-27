import { roundUp100, ratePerGram, fundingRatePerGram, ornamentValue, appraisalTotals,
         validPrincipal, valuerRule, disbursementPlan, docCharge, haircut,
         CASH_CAP_PAISE, bankRemainder } from "../src/lib/valuation.js";
let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(pass++,console.log("  ✓",n)):
  (fail++,console.log("  ✗",n,"\n      got ",JSON.stringify(g),"\n      want",JSON.stringify(w)));};

const BASE = 1210000;            // ₹12,100 per gram, 24K, in paise

console.log("\n§1 Rate per gram (R1) — matches the legacy system exactly");
eq("22K = 92%", ratePerGram(BASE, 92), 1113200);                        // ₹11,132.00
eq("20K = 83%", ratePerGram(BASE, 83), 1004300);                        // ₹10,043.00
eq("20K at 70% funding = ₹7,030.10", fundingRatePerGram(BASE, 83, 70), 703010);
eq("22K at 70% funding = ₹7,792.40", fundingRatePerGram(BASE, 92, 70), 779240);

console.log("\n§2 Round up to ₹100 (R16)");
eq("exact hundred stays", roundUp100(5330000), 5330000);
eq("one paisa over rounds up", roundUp100(5330001), 5340000);
eq("₹53,227.90 → ₹53,300", roundUp100(5322790), 5330000);
eq("zero stays zero", roundUp100(0), 0);

console.log("\n§3 Ornament values — Prathmesh's 32.150 g of 22K");
{
  const v = ornamentValue({ grossMg: 32150, stoneMg: 0, purityPct: 92, base24kPaise: BASE, fundingPct: 70 });
  eq("net weight", v.netMg, 32150);
  eq("raw market ₹3,57,893.80", v.rawMarketPaise, 35789380);
  eq("market rounds up to ₹3,57,900", v.marketPaise, 35790000);
  eq("raw funding ₹2,50,525.66", Math.round(v.rawFundingPaise), 25052566);
  eq("funding rounds up to ₹2,50,600", v.fundingPaise, 25060000);
}
{
  const v = ornamentValue({ grossMg: 16750, stoneMg: 400, purityPct: 92, base24kPaise: BASE, fundingPct: 70 });
  eq("stone weight is deducted", v.netMg, 16350);
  eq("net drives the value", v.marketPaise, roundUp100((16350 * BASE * 92) / (100 * 1000)));
}

console.log("\n§4 Grid totals");
{
  const rows = [
    ornamentValue({ grossMg: 15800, stoneMg: 0, purityPct: 92, base24kPaise: BASE, fundingPct: 70 }),
    ornamentValue({ grossMg: 16750, stoneMg: 400, purityPct: 92, base24kPaise: BASE, fundingPct: 70 }),
  ].map((v, i) => ({ ...v, qty: i + 1, grossMg: i ? 16750 : 15800, stoneMg: i ? 400 : 0 }));
  const t = appraisalTotals(rows);
  eq("two items", t.items, 2);
  eq("gross total", t.grossMg, 32550);
  eq("net total", t.netMg, 32150);
  eq("funding total is the sum of rounded rows", t.fundingPaise,
     rows[0].fundingPaise + rows[1].fundingPaise);
}

console.log("\n§5 Principal rules (R16)");
{
  const cap = { maxFundingPaise: 25060000, minLoanPaise: 500000, maxLoanPaise: 100000000 };
  eq("₹2,50,000 accepted", validPrincipal(25000000, cap).ok, true);
  eq("₹2,50,050 rejected — not a ₹100 multiple",
     validPrincipal(25005000, cap).reason, "must be a multiple of ₹100 — nearest ₹2,50,100");
  eq("above funding value rejected", validPrincipal(26000000, cap).ok, false);
  eq("below scheme minimum rejected", validPrincipal(100000, cap).ok, false);
  eq("zero rejected", validPrincipal(0, cap).ok, false);
}

console.log("\n§6 Valuer 2 rule (R17) — threshold ₹20,000");
{
  const T = 2000000;
  eq("₹15,000 needs only valuer 1", valuerRule(1500000, T, 3, null).ok, true);
  eq("₹15,000 not flagged as requiring two", valuerRule(1500000, T, 3, null).required, false);
  eq("₹50,000 without valuer 2 refused", valuerRule(5000000, T, 3, null).ok, false);
  eq("₹50,000 message explains", valuerRule(5000000, T, 3, null).reason,
     "a second valuer is compulsory above ₹20,000");
  eq("same person twice refused", valuerRule(5000000, T, 3, 3).reason, "valuer 2 must be a different person");
  eq("two different valuers accepted", valuerRule(5000000, T, 3, 4).ok, true);
  eq("no valuer 1 refused", valuerRule(1000, T, null, null).ok, false);
  eq("exactly at threshold needs only one", valuerRule(2000000, T, 3, null).ok, true);
}

console.log("\n§7 Disbursement (R11 269SS · R19 verified accounts)");
{
  const verified = (amt) => ({ amountPaise: amt, verified: true });
  eq("cash under ₹20,000 with the balance to bank",
     disbursementPlan({ principalPaise: 10000000, chargesPaise: 17700,
       cashPaise: 1900000, bankLegs: [verified(8100000)] }).ok, true);
  eq("cash at exactly ₹20,000 refused",
     disbursementPlan({ principalPaise: 10000000, chargesPaise: 0,
       cashPaise: CASH_CAP_PAISE, bankLegs: [verified(8000000)] }).problems[0],
     "cash must be under ₹20,000 (Sec 269SS) — send the balance to a bank account");
  eq("unverified account refused",
     disbursementPlan({ principalPaise: 5000000, chargesPaise: 0, cashPaise: 0,
       bankLegs: [{ amountPaise: 5000000, verified: false }] }).problems[0],
     "an unverified bank account cannot receive money");
  eq("under-allocation caught",
     disbursementPlan({ principalPaise: 5000000, chargesPaise: 0, cashPaise: 0,
       bankLegs: [verified(4000000)] }).problems[0], "₹10,000 still unallocated");
  eq("over-allocation caught",
     disbursementPlan({ principalPaise: 5000000, chargesPaise: 0, cashPaise: 0,
       bankLegs: [verified(6000000)] }).problems[0], "₹10,000 over-allocated");
  // Superseded by R-D2 (owner, 27 July 2026): the charge is collected at the first
  // repayment, so it never reduces what the customer is handed at disbursement.
  eq("charges do NOT reduce what is payable",
     disbursementPlan({ principalPaise: 5000000, chargesPaise: 17700, cashPaise: 0,
       bankLegs: [verified(5000000)] }).ok, true);
  eq("paying the old net-of-charge figure is now short",
     disbursementPlan({ principalPaise: 5000000, chargesPaise: 17700, cashPaise: 0,
       bankLegs: [verified(4982300)] }).problems[0], "₹177 still unallocated");
  eq("two verified accounts split correctly",
     disbursementPlan({ principalPaise: 10000000, chargesPaise: 0, cashPaise: 0,
       bankLegs: [verified(6000000), verified(4000000)] }).ok, true);
}

console.log("\n§8 Document charge");
{
  const c = docCharge({ principalPaise: 10000000, pct: 0.25, minPaise: 10000, maxPaise: 150000, gstPct: 18 });
  eq("0.25% of ₹1,00,000 = ₹250", c.basePaise, 25000);
  eq("GST 18% = ₹45", c.gstPaise, 4500);
  eq("total ₹295", c.totalPaise, 29500);
  eq("floor applies to small loans",
     docCharge({ principalPaise: 1000000, pct: 0.25, minPaise: 10000, maxPaise: 150000 }).basePaise, 10000);
  eq("cap applies to large loans",
     docCharge({ principalPaise: 900000000, pct: 0.25, minPaise: 10000, maxPaise: 150000 }).basePaise, 150000);
}

console.log("\n§9 Two rates — market for worth, funding for lending");
{
  const MARKET = 1204000, FUNDING = 1129000;          // ₹12,040 and ₹11,290 per gram
  eq("22K market/gram ₹11,076.80", ratePerGram(MARKET, 92), 1107680);
  eq("22K funding/gram ₹10,386.80", ratePerGram(FUNDING, 92), 1038680);
  eq("haircut is ₹750/g", haircut(MARKET, FUNDING).gapPaise, 75000);
  eq("haircut is 6.2%", Number(haircut(MARKET, FUNDING).pct.toFixed(1)), 6.2);

  const v = ornamentValue({ grossMg: 10000, stoneMg: 0, purityPct: 92,
    base24kPaise: MARKET, funding24kPaise: FUNDING, fundingPct: 70 });
  eq("10 g at 22K is worth ₹1,10,800 (rounded up)", v.marketPaise, 11080000);
  eq("funding uses the funding rate, then the scheme's 70%", v.fundingPaise,
     Math.ceil(((10000 * FUNDING * 92) / (100 * 1000)) * 0.7 / 10000) * 10000);
  eq("funding is materially below market", v.fundingPaise < v.marketPaise, true);

  const noPair = ornamentValue({ grossMg: 10000, stoneMg: 0, purityPct: 92,
    base24kPaise: MARKET, fundingPct: 70 });
  eq("older single-rate rows still price correctly", noPair.marketPaise, 11080000);
}


console.log("\n§10 Charges are collected at repayment, never netted off the disbursement (R-D2)");
{
  // ₹15,000 sanctioned, ₹118 processing charge raised on the loan.
  const p = disbursementPlan({ principalPaise: 1500000, chargesPaise: 11800,
    cashPaise: 0, bankLegs: [{ accountId: 1, amountPaise: 1500000, verified: true }] });
  eq("the customer is paid the full sanctioned amount", p.payablePaise, 1500000);
  eq("a charge does not reduce what is handed over", p.ok, true);

  const short = disbursementPlan({ principalPaise: 1500000, chargesPaise: 11800,
    cashPaise: 0, bankLegs: [{ accountId: 1, amountPaise: 1488200, verified: true }] });
  eq("paying only the old net amount now under-allocates", short.ok, false);

  eq("payable is always a multiple of 100 because the principal is (R-J)",
     disbursementPlan({ principalPaise: 800000 }).payablePaise % 10000, 0);
}

console.log("\n§11 Cash keyed in leaves the rest for the bank leg");
{
  eq("no cash — the whole amount goes by bank", bankRemainder({ payablePaise: 1500000, cashPaise: 0 }), 1500000);
  eq("₹1,000 cash leaves ₹14,000", bankRemainder({ payablePaise: 1500000, cashPaise: 100000 }), 1400000);
  eq("cash covering it all leaves nothing", bankRemainder({ payablePaise: 1500000, cashPaise: 1500000 }), 0);
  eq("cash over the payable never goes negative", bankRemainder({ payablePaise: 1500000, cashPaise: 1600000 }), 0);

  const split = disbursementPlan({ principalPaise: 1500000, cashPaise: 100000,
    bankLegs: [{ accountId: 1, amountPaise: bankRemainder({ payablePaise: 1500000, cashPaise: 100000 }), verified: true }] });
  eq("cash plus the remainder is exactly allocated", split.ok, true);
}

console.log("\n§12 The 269SS cash cap still holds after the change");
{
  const p = disbursementPlan({ principalPaise: 5000000, cashPaise: CASH_CAP_PAISE,
    bankLegs: [{ accountId: 1, amountPaise: 3000000, verified: true }] });
  eq("cash of exactly ₹20,000 is refused", p.ok, false);
  const u = disbursementPlan({ principalPaise: 5000000, cashPaise: 1000000,
    bankLegs: [{ accountId: 1, amountPaise: 4000000, verified: false }] });
  eq("an unverified account is still refused", u.problems.includes("an unverified bank account cannot receive money"), true);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
