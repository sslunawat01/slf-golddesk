import { kycStatus, blacklistState, mayLend, fullName, isMobile, isAadhaar, isPan,
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

console.log("\n§6 New-customer validation");
{
  const good = {
    firstName: "Sunil", lastName: "Deshmukh", dob: "1988-04-12", gender: "male",
    aadhaar: "123412341234", aadhaarVerified: true, pan: "AXXPP1938K", panVerified: true,
    photoFileId: 7, mobile: "9822011223",
    current: { line1: "12 Gandhi Rd", pincode: "422502" }, sameAsCurrent: true,
    idDocs: [{ docTypeId: 1, number: "1234", scans: [1] }],
    addrDocs: [{ docTypeId: 7, number: "EB-1", scans: [2] }],
    nominee: { name: "Anita Deshmukh", relation: "Wife" },
    maxOpenLoans: 3, maxOutstandingPaise: 50000000, narration: "", banks: [],
  };
  eq("complete form passes", validateNewCustomer(good).ok, true);
  eq("no photo blocks", validateNewCustomer({ ...good, photoFileId: null }).missing.identity, ["live photo"]);
  eq("unverified Aadhaar blocks", validateNewCustomer({ ...good, aadhaarVerified: false }).missing.identity,
     ["Aadhaar verification"]);
  eq("bad mobile blocks", validateNewCustomer({ ...good, mobile: "12345" }).missing.contact, ["mobile number"]);
  eq("permanent address required when not same",
     validateNewCustomer({ ...good, sameAsCurrent: false, permanent: {} }).missing.address,
     ["permanent address line 1", "permanent pincode"]);
  eq("ID proof without a photo blocks",
     validateNewCustomer({ ...good, idDocs: [{ docTypeId: 1, number: "1234", scans: [] }] }).missing.documents,
     ["ID proof with number and photo"]);
  eq("nominee required", validateNewCustomer({ ...good, nominee: {} }).missing.nominee,
     ["nominee name", "nominee relation"]);
  eq("zero limit demands narration",
     validateNewCustomer({ ...good, maxOpenLoans: 0 }).missing.limits,
     ["narration (a zero limit blacklists this customer)"]);
  eq("zero limit with narration passes",
     validateNewCustomer({ ...good, maxOpenLoans: 0, narration: "cheque dishonoured twice" }).ok, true);
  eq("blacklist flag surfaces", validateNewCustomer({ ...good, maxOpenLoans: 0 }).isBlacklisted, true);
  eq("unverified bank blocks",
     validateNewCustomer({ ...good, banks: [{ ifsc: "KKBK0001896", accountNo: "999", holderName: "Sunil" }] })
       .missing.bank, ["account 1: verification or cheque photo"]);
  eq("verified bank passes",
     validateNewCustomer({ ...good, banks: [{ ifsc: "KKBK0001896", accountNo: "999",
       holderName: "Sunil", verifiedAt: "2026-07-26" }] }).ok, true);
  eq("empty bank row ignored",
     validateNewCustomer({ ...good, banks: [{ ifsc: "", accountNo: "" }] }).ok, true);
  eq("first missing item is reported", validateNewCustomer({ ...good, firstName: "" }).first, "first name");
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

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
