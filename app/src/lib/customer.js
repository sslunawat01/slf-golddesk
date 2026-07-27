/**
 * SLF GoldDesk — customer domain rules
 * Pure functions: no database, no framework. Everything here is unit-tested.
 */

export const KYC_VALID_YEARS = 3;      // R7
export const KYC_WARN_DAYS = 90;

/** Days between two 'YYYY-MM-DD' dates (b - a). */
function daysBetween(a, b) {
  const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(b) - d(a)) / 86400000);
}
function addYears(iso, n) {
  const y = +iso.slice(0, 4) + n;
  return `${y}${iso.slice(4)}`;
}

/**
 * KYC state for a customer. Expiry blocks new lending (R7).
 * @returns {{state:'valid'|'expiring'|'expired', expiresOn:string, daysLeft:number,
 *            mayLend:boolean, label:string}}
 */
export function kycStatus(kycDoneAt, today) {
  const expiresOn = addYears(kycDoneAt, KYC_VALID_YEARS);
  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft < 0)
    return { state: "expired", expiresOn, daysLeft, mayLend: false,
             label: `KYC expired ${fmt(expiresOn)} — re-do KYC to lend` };
  if (daysLeft <= KYC_WARN_DAYS)
    return { state: "expiring", expiresOn, daysLeft, mayLend: true,
             label: `KYC expires ${fmt(expiresOn)} · ${daysLeft} days` };
  return { state: "valid", expiresOn, daysLeft, mayLend: true,
           label: `KYC valid till ${fmt(expiresOn)}` };
}
const fmt = (iso) => `${iso.slice(8,10)}-${iso.slice(5,7)}-${iso.slice(0,4)}`;

/** R14 — zero on either limit means blacklisted, and narration becomes mandatory. */
export function blacklistState(maxOpenLoans, maxOutstandingPaise, narration) {
  const zero = Number(maxOpenLoans) === 0 || Number(maxOutstandingPaise) === 0;
  return {
    isBlacklisted: zero,
    narrationRequired: zero,
    ok: !zero || !!(narration && narration.trim().length >= 5),
  };
}

/** May we start a new pledge for this customer? */
export function mayLend(customer, today) {
  if (customer.isBlacklisted) return { ok: false, reason: "blacklisted — lending blocked" };
  const k = kycStatus(customer.kycDoneAt, today);
  if (!k.mayLend) return { ok: false, reason: "KYC expired — re-do KYC to lend" };
  return { ok: true };
}

export const fullName = (f, m, l) =>
  [f, m, l].map(s => (s || "").trim()).filter(Boolean).join(" ");

export const isMobile = (s) => /^[6-9]\d{9}$/.test(String(s || "").trim());
export const isAadhaar = (s) => /^\d{12}$/.test(String(s || "").trim());
export const isPan = (s) => /^[A-Z]{5}\d{4}[A-Z]$/.test(String(s || "").trim().toUpperCase());
export const isIfsc = (s) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(s || "").trim().toUpperCase());
export const isPincode = (s) => /^[1-9]\d{5}$/.test(String(s || "").trim());

/** Bank rows must be verified before money may be sent to them (R19). */
export function bankPayable(acct) {
  if (acct.verifiedAt) return { ok: true };
  if (acct.verifyMethod === "cheque_photo" && acct.chequeFileId) return { ok: true };
  return { ok: false, reason: "unverified — cannot receive disbursement" };
}

/** GST: 27ABCDE1234F1Z5 — 2 digits, 5 letters, 4 digits, letter, digit, Z, 1 char. */
export const isGst = (s) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(s || "").toUpperCase());

/**
 * Validation for the New Customer form, tab by tab, exactly as the frozen UX defines it.
 *
 * Structure (5 tabs): Identity · Contact · Documents · Nominee · Loan settings
 *  · Identity — Aadhaar OR PAN verified is enough; both are never demanded.
 *    Corporate additionally needs a verified GST.
 *  · Contact — mobile and the current address live together; permanent address
 *    only when it differs. Mobile OTP is optional until the SMS gateway is live.
 *  · Documents — KYC documents AND the customer's bank accounts.
 *    A verified Aadhaar already proves identity and address, so no separate
 *    document is demanded; with only PAN verified, an address document is.
 */
export function validateNewCustomer(c) {
  const miss = { identity: [], contact: [], documents: [], nominee: [], limits: [] };

  // —— tab 0 · identity ——
  if (!c.firstName?.trim()) miss.identity.push("first name");
  if (!c.lastName?.trim()) miss.identity.push("last name");
  if (!c.dob) miss.identity.push("date of birth");
  if (!c.gender) miss.identity.push("gender");
  if (!c.custType) miss.identity.push("customer type");

  const aadhaarOk = isAadhaar(c.aadhaar) && c.aadhaarVerified;
  const panOk = isPan(c.pan) && c.panVerified;
  if (!aadhaarOk && !panOk) {
    if (c.aadhaar?.length && !isAadhaar(c.aadhaar)) miss.identity.push("Aadhaar number");
    else if (isAadhaar(c.aadhaar)) miss.identity.push("Aadhaar verify");
    else if (c.pan?.length && !isPan(c.pan)) miss.identity.push("PAN number");
    else if (isPan(c.pan)) miss.identity.push("PAN verify");
    else miss.identity.push("Aadhaar or PAN");
  }
  // GST is never compulsory — it is captured when the customer has one
  if (!c.photoFileId) miss.identity.push("live photo");

  // —— tab 1 · contact (mobile + address) ——
  if (!isMobile(c.mobile)) miss.contact.push("mobile number");
  else if (c.mobileDuplicate) miss.contact.push("duplicate mobile");
  if (c.altMobile && !isMobile(c.altMobile)) miss.contact.push("alternate mobile — 10 digits");
  if (!c.current?.line1?.trim()) miss.contact.push("address line 1");
  if (!isPincode(c.current?.pincode)) miss.contact.push("pincode");
  if (!c.sameAsCurrent) {
    if (!c.permanent?.line1?.trim()) miss.contact.push("permanent address line 1");
    if (!isPincode(c.permanent?.pincode)) miss.contact.push("permanent pincode");
  }

  // —— tab 2 · documents + banks ——
  const doneDocs = (c.docs || []).filter(d => d.docTypeId && d.number?.trim() && (d.scans || []).length > 0).length;
  if (!aadhaarOk && doneDocs < 1)
    miss.documents.push(panOk ? "address document with photo" : "one document with photo");
  for (const [i, b] of (c.banks || []).entries()) {
    if (!b.accountNo?.trim()) continue;
    if (!isIfsc(b.ifsc)) miss.documents.push(`account ${i + 1}: IFSC`);
    else if (!b.holderName?.trim()) miss.documents.push(`account ${i + 1}: holder name`);
    else if (!bankPayable(b).ok) miss.documents.push(`account ${i + 1}: verify/cheque`);
  }

  // —— tab 3 · nominee ——
  if (!c.nominee?.name?.trim()) miss.nominee.push("nominee name");
  if (!c.nominee?.relation) miss.nominee.push("nominee relation");
  if (c.nominee?.mobile && !isMobile(c.nominee.mobile)) miss.nominee.push("nominee mobile — 10 digits");

  // —— tab 4 · loan settings ——
  const bl = blacklistState(c.maxOpenLoans, c.maxOutstandingPaise, c.narration);
  if (!bl.ok) miss.limits.push("narration for zero limit");

  const all = Object.values(miss).flat();
  return { ok: all.length === 0, missing: miss, count: all.length,
           first: all[0] ?? null, isBlacklisted: bl.isBlacklisted };
}

/** Rank search results: exact loan number first, then customers. */
export function rankSearch(query, { loans = [], customers = [] }) {
  const q = String(query || "").trim().toLowerCase();
  const out = [];
  for (const l of loans) out.push({ kind: "loan", score: l.loanNo.toLowerCase() === q ? 100 : 80, ...l });
  for (const c of customers) {
    let score = 50;
    if (c.mobile === q) score = 70;
    else if (c.custNo?.toLowerCase() === q) score = 70;
    else if (c.fullName?.toLowerCase().startsWith(q)) score = 60;
    out.push({ kind: "customer", score, ...c });
  }
  return out.sort((a, b) => b.score - a.score);
}
