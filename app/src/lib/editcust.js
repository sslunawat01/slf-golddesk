/**
 * SLF GoldDesk — EDIT CUSTOMER RULES
 * The frozen editcust screen is deliberately narrow: Contact, Address, Nominee.
 * Name, Aadhaar/PAN, limits and documents are NOT editable here — identity is
 * KYC-anchored; contact details drift. Pure validation, no database.
 */

const REL = ["Father", "Mother", "Husband", "Wife", "Son", "Daughter", "Brother", "Sister", "Other"];
export const NOMINEE_RELATIONS = REL;

export function validContact(b = {}) {
  const problems = [];
  const mobile = String(b.mobile || "").replace(/\D/g, "");
  if (!/^[6-9]\d{9}$/.test(mobile))
    problems.push("Mobile must be a 10-digit Indian number starting 6–9");
  let altMobile = null;
  if (b.altMobile) {
    altMobile = String(b.altMobile).replace(/\D/g, "");
    if (!/^[6-9]\d{9}$/.test(altMobile))
      problems.push("The alternate mobile is not a valid 10-digit number");
    else if (altMobile === mobile)
      problems.push("The alternate mobile is the same as the main mobile");
  }
  const email = String(b.email || "").trim() || null;
  if (email && !/^\S+@\S+\.\S+$/.test(email))
    problems.push("The email does not look like an email address");
  return { ok: problems.length === 0, problems, mobile, altMobile, email };
}

export function validAddress(b = {}) {
  const problems = [];
  const line1 = String(b.line1 || "").trim();
  if (line1.length < 3) problems.push("House / street must be at least 3 characters");
  const pincode = String(b.pincode || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(pincode)) problems.push("Pincode must be exactly 6 digits");
  const t = (x) => String(x || "").trim() || null;
  return { ok: problems.length === 0, problems, line1, pincode,
    line2: t(b.line2), area: t(b.area), taluka: t(b.taluka),
    district: t(b.district), state: t(b.state) };
}

/** A nominee may be left empty (cleared), but a partial nominee is refused. */
export function validNominee(b = {}) {
  const problems = [];
  const name = String(b.name || "").trim();
  const relation = String(b.relation || "").trim();
  const mobile = b.mobile ? String(b.mobile).replace(/\D/g, "") : null;
  const empty = !name && !relation && !mobile;
  if (empty) return { ok: true, problems: [], empty: true, name: null, relation: null, mobile: null };
  if (name.length < 3) problems.push("Nominee name must be at least 3 characters");
  if (!REL.includes(relation))
    problems.push("Nominee relation must be one of: " + REL.join(", "));
  if (mobile && !/^[6-9]\d{9}$/.test(mobile))
    problems.push("The nominee's mobile is not a valid 10-digit number");
  return { ok: problems.length === 0, problems, empty: false,
    name, relation, mobile };
}

/** Did anything actually change? Saving a no-op should not write history. */
export function diffFields(before = {}, after = {}) {
  const changed = {};
  for (const k of Object.keys(after))
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
      changed[k] = { from: before[k] ?? null, to: after[k] ?? null };
  return changed;
}
