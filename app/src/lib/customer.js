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

/**
 * Everything the 7-tab form must have before Save. Returns the missing items,
 * grouped by tab, in the order the operator will meet them.
 */
export function validateNewCustomer(c) {
  const miss = { identity: [], contact: [], address: [], documents: [], nominee: [], limits: [], bank: [] };

  if (!c.firstName?.trim()) miss.identity.push("first name");
  if (!c.lastName?.trim()) miss.identity.push("last name");
  if (!c.dob) miss.identity.push("date of birth");
  if (!c.gender) miss.identity.push("gender");
  if (!isAadhaar(c.aadhaar)) miss.identity.push("Aadhaar number");
  else if (!c.aadhaarVerified) miss.identity.push("Aadhaar verification");
  if (!isPan(c.pan)) miss.identity.push("PAN");
  else if (!c.panVerified) miss.identity.push("PAN verification");
  if (!c.photoFileId) miss.identity.push("live photo");

  if (!isMobile(c.mobile)) miss.contact.push("mobile number");
  if (c.altMobile && !isMobile(c.altMobile)) miss.contact.push("alternate mobile is not valid");

  if (!c.current?.line1?.trim()) miss.address.push("address line 1");
  if (!isPincode(c.current?.pincode)) miss.address.push("pincode");
  if (!c.sameAsCurrent) {
    if (!c.permanent?.line1?.trim()) miss.address.push("permanent address line 1");
    if (!isPincode(c.permanent?.pincode)) miss.address.push("permanent pincode");
  }

  const hasDoc = (list) => (list || []).some(d => d.docTypeId && d.number?.trim() && (d.scans || []).length > 0);
  if (!hasDoc(c.idDocs)) miss.documents.push("ID proof with number and photo");
  if (!hasDoc(c.addrDocs)) miss.documents.push("address proof with number and photo");

  if (!c.nominee?.name?.trim()) miss.nominee.push("nominee name");
  if (!c.nominee?.relation) miss.nominee.push("nominee relation");

  const bl = blacklistState(c.maxOpenLoans, c.maxOutstandingPaise, c.narration);
  if (!bl.ok) miss.limits.push("narration (a zero limit blacklists this customer)");

  for (const [i, b] of (c.banks || []).entries()) {
    if (!b.accountNo?.trim() && !b.ifsc?.trim()) continue;
    if (!isIfsc(b.ifsc)) miss.bank.push(`account ${i + 1}: IFSC`);
    if (!b.accountNo?.trim()) miss.bank.push(`account ${i + 1}: account number`);
    if (!b.holderName?.trim()) miss.bank.push(`account ${i + 1}: holder name`);
    else if (!bankPayable(b).ok) miss.bank.push(`account ${i + 1}: verification or cheque photo`);
  }

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
