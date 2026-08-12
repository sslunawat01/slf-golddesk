/**
 * SLF GoldDesk — METAL / PURITY / ITEM / SAFE MASTER RULES
 * Pure validation, no database. Verified against \d on 12 Aug 2026:
 *  · metal(kind metal_kind ENUM, enabled, valued_as_pct_of_gold)
 *  · purity(metal_id, karat, purity_pct, effective_from/to, active)
 *      UNIQUE(metal_id, karat, effective_from) — edits are VERSIONED:
 *      end-date the old row, insert a new one; old appraisals keep their
 *      snapshot AND their row.
 *  · item(name, print_name NOT NULL, metal_id, description, active)
 *      UNIQUE(name, metal_id)
 *  · safe(branch_id, label, location_note, active) UNIQUE(branch_id, label)
 */

// ————————————————————————— purity —————————————————————————

/**
 * @param {{karat?:string, pct?:string|number, metalId?:number}} b
 * @param {{valuedAsPctOfGold?:boolean}} metal how this metal prices
 */
export function validPurity(b = {}, metal = {}) {
  const problems = [];
  const karat = String(b.karat || "").trim();
  if (karat.length < 2) problems.push("Give the grade a name of at least 2 characters (e.g. 22K, Silver99)");
  if (karat.length > 20) problems.push("Keep the grade name under 20 characters");
  const pct = Number(b.pct);
  if (!(pct > 0)) problems.push("Purity % must be greater than zero");
  else if (!metal.valuedAsPctOfGold && pct > 100)
    problems.push("Purity of a directly-rated metal cannot exceed 100%");
  else if (metal.valuedAsPctOfGold && pct > 25)
    problems.push("This metal prices as a % of the GOLD rate — a figure above 25 looks like a typo");
  if (!Number(b.metalId)) problems.push("Pick the metal this grade belongs to");
  // 4 decimal places max — the column is numeric(7,4)
  if (pct > 0 && Math.round(pct * 10000) !== pct * 10000)
    problems.push("Purity % allows at most 4 decimal places");
  return { ok: problems.length === 0, problems, karat, pct, metalId: Number(b.metalId) || null };
}

/** Rate per gram at a purity, in paise. For %-of-gold metals, base = GOLD's base. */
export function rateAtPurity(basePaise, pct) {
  return Math.round(Number(basePaise) * Number(pct) / 100);
}

// ————————————————————————— item —————————————————————————

export function validItem(b = {}) {
  const problems = [];
  const name = String(b.name || "").trim();
  if (name.length < 2) problems.push("Give the item a name of at least 2 characters");
  const printName = String(b.printName || "").trim().toUpperCase();
  if (printName.length < 2) problems.push("Give a print name — it appears on the pledge card and receipts");
  if (printName.length > 30) problems.push("Keep the print name under 30 characters");
  if (!Number(b.metalId)) problems.push("Pick the metal this item is made of");
  const description = String(b.description || "").trim() || null;
  return { ok: problems.length === 0, problems, name, printName,
    metalId: Number(b.metalId) || null, description };
}

// ————————————————————————— safe —————————————————————————

export function validSafe(b = {}) {
  const problems = [];
  const label = String(b.label || "").trim();
  if (label.length < 2) problems.push("Give the safe a label of at least 2 characters (e.g. Safe A — main vault)");
  if (label.length > 60) problems.push("Keep the safe label under 60 characters");
  if (!Number(b.branchId)) problems.push("The safe must belong to a branch");
  return { ok: problems.length === 0, problems, label,
    branchId: Number(b.branchId) || null,
    locationNote: String(b.locationNote || "").trim() || null };
}

/**
 * A safe holding even one packet can never be switched off — the gold would
 * be recorded inside a safe that "does not exist".
 * @param {number} packetsInside packets whose LAST movement is IN to this safe
 */
export function canDeactivateSafe(packetsInside) {
  const n = Number(packetsInside) || 0;
  if (n > 0) return { ok: false,
    reason: `${n} packet${n === 1 ? " is" : "s are"} inside this safe — move the gold out before switching it off` };
  return { ok: true };
}

// ————————————————————————— metal —————————————————————————

/**
 * metal.kind is a database ENUM: the screen may only offer kinds the database
 * already knows AND that are not yet in the table. A brand-new kind is a
 * schema change, not a settings click — the UI says so honestly.
 * @param {string[]} enumKinds from enum_range(NULL::metal_kind)
 * @param {string[]} existingKinds kinds already inserted
 */
export function addableMetalKinds(enumKinds = [], existingKinds = []) {
  const have = new Set(existingKinds.map(k => String(k).toLowerCase()));
  return enumKinds.filter(k => !have.has(String(k).toLowerCase()));
}
