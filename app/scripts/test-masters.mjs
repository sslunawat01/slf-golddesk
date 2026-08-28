import { validCharge, validBranch, validSchemeVersion, slabSample, SUPPORTED_CALC }
  from "../src/lib/masters.js";
let pass = 0, fail = 0;
const ok = (n, r) => { r.ok ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "\n      problems:", JSON.stringify(r.problems))); };
const no = (n, r, phrase) => { const hit = !r.ok && r.problems.some(p => p.toLowerCase().includes(phrase));
  hit ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n, "\n      problems:", JSON.stringify(r.problems))); };
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w); k ? (pass++, console.log("  ✓", n)) :
  (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };

console.log("\n§1 A charge must say how it is calculated");
ok("a fixed charge with an amount is fine",
  validCharge({ name: "Notice", calc: "fixed", amountRs: 118, gstPct: 18 }));
ok("a percentage charge with min and max is fine",
  validCharge({ name: "Processing", calc: "percent", pct: 0.25, minRs: 100, maxRs: 1500, gstPct: 18 }));
no("a fixed charge without an amount is refused",
  validCharge({ name: "Notice", calc: "fixed" }), "amount above zero");
no("a percentage above 100 is refused",
  validCharge({ name: "X", calc: "percent", pct: 120 }), "cannot exceed 100");
no("a floor above the cap is refused",
  validCharge({ name: "X", calc: "percent", pct: 1, minRs: 2000, maxRs: 500 }), "minimum cannot exceed");
no("a two-letter name is refused", validCharge({ name: "ab", calc: "fixed", amountRs: 10 }), "3 characters");
no("GST of 200% is refused",
  validCharge({ name: "Notice", calc: "fixed", amountRs: 100, gstPct: 200 }), "gst");

console.log("\n§2 A branch code is forever — it is printed into every loan number");
ok("a two-digit code is fine",
  validBranch({ code: "04", name: "B4 Sinnar", entityId: 1, phone: "9822012345", phone2: "0253231234", email: "b4@slf.in", address: "Main Rd, Sinnar, Nashik 422103", latitude: 19.85, longitude: 74.0, existingCodes: ["01", "02", "03"] }));
no("a taken code is refused",
  validBranch({ code: "01", name: "Dup", entityId: 1, existingCodes: ["01"] }), "already taken");
no("letters in the code are refused",
  validBranch({ code: "B4X", name: "B4 Sinnar", entityId: 1, phone: "9822012345", phone2: "0253231234", email: "b4@slf.in", address: "Main Rd, Sinnar, Nashik 422103", latitude: 19.85, longitude: 74.0, existingCodes: [] }), "exactly 2");
ok("a letter+digit code like b4 is welcome now (D-C)",
  validBranch({ code: "b4", name: "B4 Sinnar", entityId: 1, phone: "9822012345", phone2: "0253231234", email: "b4@slf.in", address: "Main Rd, Sinnar, Nashik 422103", latitude: 19.85, longitude: 74.0, existingCodes: [] }));
eq("the code is stored uppercase",
  validBranch({ code: "b4", name: "B4 Sinnar", entityId: 1, phone: "9822012345", phone2: "0253231234", email: "b4@slf.in", address: "Main Rd, Sinnar, Nashik 422103", latitude: 19.85, longitude: 74.0, existingCodes: [] }).code, "B4");
no("a branch without email is refused (№8 — all fields compulsory)",
  validBranch({ code: "04", name: "B4 Sinnar", entityId: 1, phone: "9822012345", phone2: "0253231234", address: "Main Rd, Sinnar, Nashik 422103", latitude: 19.85, longitude: 74.0, existingCodes: [] }), "email");
no("a branch without coordinates is refused (№8)",
  validBranch({ code: "04", name: "B4 Sinnar", entityId: 1, phone: "9822012345", phone2: "0253231234", email: "b4@slf.in", address: "Main Rd, Sinnar, Nashik 422103", longitude: 74.0, existingCodes: [] }), "latitude");
no("a branch must belong to an entity",
  validBranch({ code: "04", name: "B4 Sinnar", existingCodes: [] }), "entity");

console.log("\n§3 Only what the engine can price may become a scheme");
const base = { code: "GL2599", name: "Test scheme", calcMethod: "simple", interestPct: 22,
  daysInYear: 365, minInterestDays: 15, tenureDays: 365, penalRatePct: 2, penalGraceDays: 7,
  fundingPct: 75, minLoanRs: 5000, maxLoanRs: 1000000, docChargePct: 0.25, docMinRs: 100,
  docMaxRs: 1500, effectiveFrom: "2026-08-01", isNewScheme: true, existingCodes: ["GL2070"] };
ok("a simple scheme with sane numbers passes", validSchemeVersion(base));
no("compound is refused until the engine learns it",
  validSchemeVersion({ ...base, calcMethod: "compound" }), "engine extended");
no("EMI is refused until the engine learns it",
  validSchemeVersion({ ...base, calcMethod: "emi" }), "engine extended");
eq("the supported list is exactly simple and slab", SUPPORTED_CALC, ["simple", "slab"]);

console.log("\n§4 Slabs must join up and cover the tenure");
const slabBase = { ...base, code: "SB-NEW1", calcMethod: "slab", slabMode: "retroactive",
  tenureDays: 185, interestPct: undefined,
  slabs: [ { fromDay: 1, toDay: 62, ratePct: 15 }, { fromDay: 63, toDay: 123, ratePct: 18 },
           { fromDay: 124, toDay: 185, ratePct: 21 } ] };
ok("three joined slabs covering the tenure pass", validSchemeVersion(slabBase));
no("a gap between slabs is refused",
  validSchemeVersion({ ...slabBase, slabs: [ { fromDay: 1, toDay: 62, ratePct: 15 },
    { fromDay: 70, toDay: 185, ratePct: 18 } ] }), "no gaps");
no("an overlap is refused",
  validSchemeVersion({ ...slabBase, slabs: [ { fromDay: 1, toDay: 62, ratePct: 15 },
    { fromDay: 60, toDay: 185, ratePct: 18 } ] }), "no gaps");
no("slabs stopping short of the tenure are refused",
  validSchemeVersion({ ...slabBase, slabs: [ { fromDay: 1, toDay: 62, ratePct: 15 },
    { fromDay: 63, toDay: 123, ratePct: 18 } ] }), "cover the whole tenure");
no("a single slab is refused — that is simple interest wearing a costume",
  validSchemeVersion({ ...slabBase, slabs: [ { fromDay: 1, toDay: 185, ratePct: 15 } ] }),
  "at least two");
no("a slab starting at day 5 is refused",
  validSchemeVersion({ ...slabBase, slabs: [ { fromDay: 5, toDay: 100, ratePct: 15 },
    { fromDay: 101, toDay: 185, ratePct: 18 } ] }), "start at day 1");

console.log("\n§5 Guard rails on the numbers");
no("a duplicate scheme code is refused",
  validSchemeVersion({ ...base, code: "GL2070" }), "already exists");
// rewritten 13 Aug 2026 (owner amendment): 360-day years are now a valid choice
ok("a 360-day year is accepted - the divisor is a commercial choice",
  validSchemeVersion({ ...base, daysInYear: 360 }));
no("a 36-day 'year' is still refused as a typo",
  validSchemeVersion({ ...base, daysInYear: 36 }), "between 300 and 370");
no("a fractional year is refused",
  validSchemeVersion({ ...base, daysInYear: 365.25 }), "between 300 and 370");
no("minimum days beyond the tenure is refused",
  validSchemeVersion({ ...base, minInterestDays: 400 }), "cannot exceed the tenure");
no("a 150% interest rate is treated as a typo",
  validSchemeVersion({ ...base, interestPct: 150 }), "typing mistake");
no("funding of 95% is flagged for confirmation",
  validSchemeVersion({ ...base, fundingPct: 95 }), "cushion");
no("a minimum loan of ₹5,050 is refused",
  validSchemeVersion({ ...base, minLoanRs: 5050 }), "multiple of ₹100");
no("penal of 48% is refused", validSchemeVersion({ ...base, penalRatePct: 48 }), "0 and 36");

console.log("\n§6 The review table's worked example");
eq("62 days at 15% on ₹1,00,000", slabSample({ fromDay: 1, toDay: 62, ratePct: 15 }), 2548);
eq("the second band prices only its own days",
   slabSample({ fromDay: 63, toDay: 123, ratePct: 18 }), 3008);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
