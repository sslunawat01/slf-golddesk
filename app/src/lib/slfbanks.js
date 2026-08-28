/**
 * SLF GoldDesk — COMPANY BANK ACCOUNT MASTER RULES (№8)
 * slf_bank_account (verified \d 17 Aug 2026): nickname UNIQUE, bank, ifsc,
 * account_no (FULL — owner decision 27 Aug 2026, mig 017), account_no_masked,
 * allow_disbursement, allow_collection, ledger_id, active.
 * Branch scope lives in slf_bank_account_branch — NO rows = every branch.
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
  // owner decision 27 Aug 2026: the FULL number is stored (system pre-production)
  const accountNo = String(b.accountNo || "").replace(/\D/g, "");
  if (accountNo.length < 9 || accountNo.length > 18)
    problems.push("Account number must be 9–18 digits");
  const masked = maskAccount(accountNo);
  if (!b.allowDisbursement && !b.allowCollection)
    problems.push("Tick at least one use — disbursement, collection, or both");
  const branchIds = [...new Set((Array.isArray(b.branchIds) ? b.branchIds : [])
    .map(Number).filter(n => n > 0))];
  const scopeAll = b.scopeAll !== false;   // explicit scope (mig 019); default all
  return { ok: problems.length === 0, problems, nickname, bank, ifsc, accountNo, masked,
    branchIds: scopeAll ? [] : branchIds, scopeAll,
    ledgerId: Number(b.ledgerId) || null,
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
