/**
 * SLF GoldDesk — COMPANY BANK ACCOUNT MASTER RULES (№8)
 * slf_bank_account (verified \d 17 Aug 2026): nickname UNIQUE, bank, ifsc,
 * account_no_masked, branch_id NULLABLE, allow_disbursement, allow_collection,
 * ledger_id, active. THE FULL ACCOUNT NUMBER IS NEVER STORED — masked only,
 * by schema design. branch_id NULL means every branch may use it.
 */

/** '00311234567890' → '··········7890' (always keeps exactly the last 4). */
export function maskAccount(no) {
  const s = String(no || "").replace(/\D/g, "");
  if (s.length < 4) return null;
  return "·".repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}

export function validSlfBank(b = {}) {
  const problems = [];
  const nickname = String(b.nickname || "").trim();
  if (nickname.length < 3)
    problems.push("Give the account a nickname of at least 3 characters (e.g. HDFC current — HO)");
  if (nickname.length > 40) problems.push("Keep the nickname under 40 characters");
  const bank = String(b.bank || "").trim();
  if (bank.length < 2) problems.push("Name the bank");
  const ifsc = String(b.ifsc || "").trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) problems.push("IFSC must look like HDFC0001234");
  const masked = maskAccount(b.accountNo);
  if (!masked) problems.push("Enter the account number — at least the last 4 digits are kept");
  if (!b.allowDisbursement && !b.allowCollection)
    problems.push("Tick at least one use — disbursement, collection, or both");
  return { ok: problems.length === 0, problems, nickname, bank, ifsc, masked,
    branchId: Number(b.branchId) || null, ledgerId: Number(b.ledgerId) || null,
    allowDisbursement: !!b.allowDisbursement, allowCollection: !!b.allowCollection };
}

/**
 * An account referenced by even one disbursement or transfer is history —
 * it deactivates, never deletes. (Deletion is refused by FKs anyway; the
 * screen never offers it.)
 */
export function deactivationNote(usedOn) {
  return Number(usedOn) > 0
    ? `${usedOn} payment${Number(usedOn) === 1 ? "" : "s"} reference this account — it can be switched off but never deleted`
    : "Unused — switching off simply hides it from the pickers";
}
