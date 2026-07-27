import { kycStatus, blacklistState, mayLend, fullName, isMobile, isAadhaar, isPan, isGst,
         isIfsc, isPincode, bankPayable, validateNewCustomer, rankSearch } from "../src/lib/customer.js";

let pass = 0, fail = 0;
const eq = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? (pass++, console.log("  ✓", n))
     : (fail++, console.log("  ✗", n, "\n      got ", JSON.stringify(got), "\n      want", JSON.stringify(want)));
};
const TODAY = "2026-07-26";

console.log("\n§1 KYC 3-year clock (R7)");
{
  eq("fresh KYC is valid", kycStatus("2026-02-03", TODAY).state, "valid");
  eq("valid label names the date", kycStatus("2026-02-03", TODAY).label, "KYC valid till 03-02-2029");
  eq("2024 KYC still valid", kycStatus("2024-08-12", TODAY).state, "valid");
  eq("expired 2022 KYC", kycStatus("2022-09-19", TODAY).state, "expired");
  eq("expired blocks lending", kycStatus("2022-09-19", TODAY).mayLend, false);
  eq("90-day amber window", kycStatus("2023-08-20", TODAY).state, "expiring");
  eq("expiring still lends", kycStatus("2023-08-20", TODAY).mayLend, true);
  eq("day-of-expiry still valid", kycStatus("2023-07-26", TODAY).daysLeft, 0);
  eq("day-after is expired", kycStatus("2023-07-25", TODAY).state, "expired");
}

console.log("\n§2 Blacklist rule (R14)");
{
  eq("normal limits are clean", blacklistState(3, 50000000, "").isBlacklisted, false);
  eq("zero loans blacklists", blacklistState(0, 50000000, "").isBlacklisted, true);
  eq("zero outstanding blacklists", blacklistState(3, 0, "").isBlacklisted, true);
  eq("zero without narration is invalid", blacklistState(0, 0, "").ok, false);
  eq("short narration rejected", blacklistState(0, 0, "bad").ok, false);
  eq("proper narration accepted", blacklistState(0, 0, "cheque dishonoured twice").ok, true);
}

console.log("\n§3 May we lend?");
{
  eq("healthy customer", mayLend({ isBlacklisted: false, kycDoneAt: "2026-02-03" }, TODAY).ok, true);
  eq("blacklisted refused", mayLend({ isBlacklisted: true, kycDoneAt: "2026-02-03" }, TODAY).reason,
     "blacklisted — lending blocked");
  eq("expired KYC refused", mayLend({ isBlacklisted: false, kycDoneAt: "2022-09-19" }, TODAY).reason,
     "KYC expired — re-do KYC to lend");
}

console.log("\n§4 Field formats");
{
  eq("name assembly skips blank middle", fullName("Prathmesh", "", "Kasar"), "Prathmesh Kasar");
  eq("name assembly keeps middle", fullName("Prathmesh", "Hanumanta", "Kasar"), "Prathmesh Hanumanta Kasar");
  eq("valid mobile", isMobile("7709046316"), true);
  eq("mobile starting 5 rejected", isMobile("5709046316"), false);
  eq("9-digit mobile rejected", isMobile("770904631"), false);
  eq("aadhaar 12 digits", isAadhaar("123412341234"), true);
  eq("aadhaar 11 rejected", isAadhaar("12341234123"), false);
  eq("valid PAN", isPan("AXXPP1938K"), true);
  eq("PAN lowercase accepted", isPan("axxpp1938k"), true);
  eq("malformed PAN rejected", isPan("AXXP1938KK"), false);
  eq("valid IFSC", isIfsc("KKBK0001896"), true);
  eq("IFSC without 0 in 5th rejected", isIfsc("KKBK1001896"), false);
  eq("valid pincode", isPincode("422502"), true);
  eq("pincode starting 0 rejected", isPincode("022502"), false);
}

console.log("\n§5 Bank payability (R19)");
{
  eq("penny-drop verified is payable", bankPayable({ verifiedAt: "2026-07-01" }).ok, true);
  eq("cheque fallback is payable", bankPayable({ verifyMethod: "cheque_photo", chequeFileId: 9 }).ok, true);
  eq("unverified refused", bankPayable({ verifyMethod: "none" }).ok, false);
  eq("cheque claimed without photo refused", bankPayable({ verifyMethod: "cheque_photo" }).ok, false);
}

console.log("\n§6 New-customer validation — the frozen 5-tab form");
{
  // Aadhaar route: a verified Aadhaar proves identity AND address, so no extra document
  const aadhaarRoute = {
    firstName: "Sunita", lastName: "Pawar", dob: "1979-03-14", gender: "female", custType: "individual",
    aadhaar: "482913756204", aadhaarVerified: true, pan: "", panVerified: false,
    photoFileId: 7, mobile: "9421338071",
    current: { line1: "12 Shivneri Colony", pincode: "422502" }, sameAsCurrent: true,
    docs: [], banks: [],
    nominee: { name: "Ramesh Pawar", relation: "Husband" },
    maxOpenLoans: 3, maxOutstandingPaise: 30000000, narration: "",
  };
  eq("Aadhaar alone is enough", validateNewCustomer(aadhaarRoute).ok, true);
  eq("no separate document demanded with Aadhaar",
     validateNewCustomer(aadhaarRoute).missing.documents, []);

  // PAN route: identity proven, address not — one address document required
  const panRoute = { ...aadhaarRoute, aadhaar: "", aadhaarVerified: false,
    pan: "AKQPP4821L", panVerified: true };
  eq("PAN alone needs an address document",
     validateNewCustomer(panRoute).missing.documents, ["address document with photo"]);
  eq("PAN plus a document passes",
     validateNewCustomer({ ...panRoute, docs: [{ docTypeId: 7, number: "MSEB-1", scans: [3] }] }).ok, true);

  // neither
  eq("neither Aadhaar nor PAN",
     validateNewCustomer({ ...aadhaarRoute, aadhaar: "", aadhaarVerified: false }).missing.identity,
     ["Aadhaar or PAN", "one document with photo"].slice(0, 1));
  eq("unverified Aadhaar asks for verification",
     validateNewCustomer({ ...aadhaarRoute, aadhaarVerified: false }).missing.identity, ["Aadhaar verify"]);

  // GST is optional for everyone, corporate included
  const corp = { ...aadhaarRoute, custType: "corporate" };
  eq("corporate saves without GST", validateNewCustomer(corp).ok, true);
  eq("corporate with GST also saves",
     validateNewCustomer({ ...corp, gstin: "27ABCDE1234F1Z5", gstVerified: true }).ok, true);
  eq("GST format checker", isGst("27ABCDE1234F1Z5"), true);
  eq("bad GST rejected", isGst("27ABCDE1234F1X5"), false);

  // contact tab carries the address
  eq("address missing shows under contact",
     validateNewCustomer({ ...aadhaarRoute, current: { line1: "", pincode: "" } }).missing.contact,
     ["address line 1", "pincode"]);
  eq("permanent address required when different",
     validateNewCustomer({ ...aadhaarRoute, sameAsCurrent: false, permanent: {} }).missing.contact,
     ["permanent address line 1", "permanent pincode"]);
  eq("duplicate mobile blocks",
     validateNewCustomer({ ...aadhaarRoute, mobileDuplicate: true }).missing.contact, ["duplicate mobile"]);
  eq("mobile OTP is NOT compulsory (SMS not connected)",
     validateNewCustomer({ ...aadhaarRoute, mobileVerified: false }).ok, true);
  eq("no photo blocks", validateNewCustomer({ ...aadhaarRoute, photoFileId: null }).missing.identity,
     ["live photo"]);

  // banks live in the documents tab
  eq("unverified bank blocks under documents",
     validateNewCustomer({ ...aadhaarRoute,
       banks: [{ ifsc: "KKBK0001896", accountNo: "999", holderName: "Sunita" }] }).missing.documents,
     ["account 1: verify/cheque"]);
  eq("verified bank passes",
     validateNewCustomer({ ...aadhaarRoute, banks: [{ ifsc: "KKBK0001896", accountNo: "999",
       holderName: "Sunita", verifiedAt: "2026-07-27" }] }).ok, true);
  eq("cheque fallback passes",
     validateNewCustomer({ ...aadhaarRoute, banks: [{ ifsc: "KKBK0001896", accountNo: "999",
       holderName: "Other Name", verifyMethod: "cheque_photo", chequeFileId: 4 }] }).ok, true);
  eq("empty bank row ignored",
     validateNewCustomer({ ...aadhaarRoute, banks: [{ ifsc: "", accountNo: "" }] }).ok, true);

  // nominee & limits
  eq("nominee required", validateNewCustomer({ ...aadhaarRoute, nominee: {} }).missing.nominee,
     ["nominee name", "nominee relation"]);
  eq("nominee mobile length checked",
     validateNewCustomer({ ...aadhaarRoute, nominee: { name: "R", relation: "Husband", mobile: "94213" } })
       .missing.nominee, ["nominee mobile — 10 digits"]);
  eq("zero limit demands narration",
     validateNewCustomer({ ...aadhaarRoute, maxOpenLoans: 0 }).missing.limits,
     ["narration for zero limit"]);
  eq("zero limit with narration passes",
     validateNewCustomer({ ...aadhaarRoute, maxOpenLoans: 0, narration: "cheque dishonoured twice" }).ok, true);
  eq("blacklist flag surfaces",
     validateNewCustomer({ ...aadhaarRoute, maxOpenLoans: 0 }).isBlacklisted, true);
  eq("first missing item is reported",
     validateNewCustomer({ ...aadhaarRoute, firstName: "" }).first, "first name");
}

console.log("\n§7 Search ranking — loan numbers win");
{
  const r = rankSearch("01A6702204", {
    loans: [{ loanNo: "01A6702204", customer: "Komal" }],
    customers: [{ custNo: "IND0009402", fullName: "Komal Mali", mobile: "8975249307" }],
  });
  eq("exact loan first", r[0].kind, "loan");
  const byMobile = rankSearch("8975249307", {
    loans: [], customers: [
      { custNo: "IND0012619", fullName: "Prathmesh Kasar", mobile: "7709046316" },
      { custNo: "IND0009402", fullName: "Komal Mali", mobile: "8975249307" }] });
  eq("exact mobile ranks first", byMobile[0].custNo, "IND0009402");
  const byName = rankSearch("kom", { loans: [], customers: [
      { custNo: "IND0012619", fullName: "Prathmesh Kasar", mobile: "7709046316" },
      { custNo: "IND0009402", fullName: "Komal Mali", mobile: "8975249307" }] });
  eq("name prefix ranks first", byName[0].custNo, "IND0009402");
}

console.log("\n§8 Enum values must never carry display capitalisation");
{
  const norm = (v, allowed) => { const x = String(v ?? "").trim().toLowerCase();
    return allowed.includes(x) ? x : null; };
  const RISK = ["low","medium","high"], GENDER = ["male","female","other"],
        TYPE = ["individual","corporate","huf","partnership","trust"];
  eq("'Low' becomes 'low'", norm("Low", RISK), "low");
  eq("'HIGH' becomes 'high'", norm("HIGH", RISK), "high");
  eq("already lowercase passes", norm("medium", RISK), "medium");
  eq("blank becomes null", norm("", RISK), null);
  eq("nonsense becomes null instead of breaking the insert", norm("Very High", RISK), null);
  eq("'Male' becomes 'male'", norm("Male", GENDER), "male");
  eq("'Corporate' becomes 'corporate'", norm("Corporate", TYPE), "corporate");
  eq("'Trust / society' is not a value", norm("Trust / society", TYPE), null);
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
