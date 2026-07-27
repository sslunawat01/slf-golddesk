/**
 * SLF GoldDesk — VAULT RULES
 *
 * Pure functions. The caller loads rows and passes them in, so every rule here
 * is testable with no database — same discipline as policy.js and valuation.js.
 *
 * Principles (locked with the owner, 27 July 2026):
 *  · Vault-in is the NEXT working day. The packet sleeps at the counter tonight.
 *  · All three rechecks must be ticked and the sealed packet photographed
 *    before anything enters a safe. Printing the QR tag does NOT gate it.
 *  · Single-user action. SLF deliberately does not use dual custodians, so the
 *    one name on the movement row is the whole accountability chain.
 *  · O10 — a mismatch is never a dead end. It freezes the packet with a reason,
 *    a written narration and a photograph. It never writes a movement row,
 *    because the gold did not move into a safe.
 */

export const MISMATCH_REASONS = [
  { code: "seal_broken", label: "Seal was broken or tampered with" },
  { code: "item_count",  label: "Item count or description does not match" },
  { code: "weight",      label: "Net weight does not match the appraisal note" },
  { code: "other",       label: "Something else" },
];

/** A mismatch narration must be a real sentence, not a shrug. */
export const MIN_NARRATION = 10;

/**
 * May this packet be put into a safe?
 * @param {{sealIntact:boolean, itemsMatch:boolean, weightMatch:boolean,
 *          sealPhotoFileId:number|null, safeId:number|null,
 *          packetStatus:string}} c
 * @returns {{ok:boolean, problems:string[]}}
 */
export function vaultInReady(c = {}) {
  const problems = [];
  if (c.packetStatus === "in_safe")  problems.push("This packet is already in a safe");
  if (c.packetStatus === "frozen")   problems.push("This packet is frozen after a mismatch — Head Office must clear it");
  if (c.packetStatus === "out")      problems.push("This packet has left the vault");
  if (!c.sealIntact)      problems.push("Confirm the seal was intact when the packet was opened");
  if (!c.itemsMatch)      problems.push("Confirm the item count and description match the appraisal note");
  if (!c.weightMatch)     problems.push("Confirm the net weight was re-checked on the scale");
  if (!c.sealPhotoFileId) problems.push("Capture a photograph of the sealed packet");
  if (!c.safeId)          problems.push("Choose the safe or locker the packet goes into");
  return { ok: problems.length === 0, problems };
}

/**
 * Is this a properly evidenced mismatch report?
 * @param {{reason:string, note:string, photoFileId:number|null, packetStatus:string}} c
 * @returns {{ok:boolean, problems:string[]}}
 */
export function mismatchReady(c = {}) {
  const problems = [];
  if (c.packetStatus === "in_safe")
    problems.push("This packet is already in a safe — raise a spot-check instead");
  if (c.packetStatus === "frozen")
    problems.push("This packet is already frozen");
  if (!MISMATCH_REASONS.some(r => r.code === c.reason))
    problems.push("Choose what did not match");
  if (String(c.note || "").trim().length < MIN_NARRATION)
    problems.push(`Describe what you found in at least ${MIN_NARRATION} characters`);
  if (!c.photoFileId)
    problems.push("Photograph what you found — this is the evidence");
  return { ok: problems.length === 0, problems };
}

/**
 * Which filter bucket a waiting packet falls into.
 * "Disbursed today" means the gold is not yet due — vault-in is tomorrow.
 * @param {string} disbursedAt 'YYYY-MM-DD'
 * @param {string} today       'YYYY-MM-DD'
 */
export function vaultInBucket(disbursedAt, today) {
  return String(disbursedAt) >= String(today) ? "today" : "since_yesterday";
}

/**
 * Counts for the three filter chips on the list screen.
 * @param {{disbursedAt:string}[]} rows
 * @param {string} today
 */
export function bucketCounts(rows = [], today) {
  let sinceYesterday = 0, disbursedToday = 0;
  for (const r of rows) {
    if (vaultInBucket(r.disbursedAt, today) === "today") disbursedToday++;
    else sinceYesterday++;
  }
  return { all: rows.length, sinceYesterday, disbursedToday };
}

/** Milligrams to the 3-decimal grams the counter reads on the scale. */
export function mgToGrams(mg) {
  return (Number(mg || 0) / 1000).toFixed(3);
}

/**
 * What the QR on the tag carries. Deliberately not a URL: a lost tag should
 * not hand a finder a working link into the system.
 */
export function qrPayload({ packetNo, loanNo, branchCode }) {
  return `SLF|${branchCode}|${packetNo}|${loanNo}`;
}
