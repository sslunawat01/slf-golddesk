/**
 * SLF GoldDesk — FOLLOW-UP RULES (E33, owner 15 Oct 2026)
 * Pure: labels, validation, due/missed classification, promise (PTP) status,
 * system suggestions, date presets. No database, no clock — `today` is an
 * argument everywhere, so every rule is unit-testable.
 *
 * A follow-up is one row of collection_call (append-only). It records what
 * was done AND what comes next (next_follow_up + next_type + assigned_to).
 * "Due" is derived: the latest row of a loan that names a next date and has
 * no later row. "Missed" = that date is before today. Nothing is ever
 * deleted or expired — a missed item stays until someone logs against it.
 */

export const TYPES = [
  ["interest", "Interest reminder"], ["ptp", "PTP check"], ["overdue", "Overdue · past tenure"],
  ["renewal", "Renewal due"], ["notice", "Auction / legal notice"], ["kyc", "KYC renewal"],
  ["other", "Courtesy / other"]];
export const CHANNELS = [
  ["call", "Phone call"], ["visit", "Home visit"], ["sms", "SMS"], ["whatsapp", "WhatsApp"],
  ["email", "Email"], ["ai_call", "AI voice call"], ["notice", "Notice (printed)"]];
/** Outcomes in the order the screen offers them; the DB enum call_outcome holds the keys. */
export const OUTCOMES = [
  ["promised", "Promised to pay"], ["will_renew", "Will renew"], ["paid", "Paid / paying now"],
  ["disputed", "Disputes the amount"], ["no_answer", "No answer / switched off"],
  ["not_at_home", "Not at home"], ["wrong_number", "Wrong number"], ["notice_sent", "Notice sent"],
  ["other", "Other"]];
/** Channels that SEND something from GoldDesk — live only once a provider is wired (ledger). */
export const CHANNEL_SENDS = { sms: "SMS provider", ai_call: "AI-call provider" };
export const QUICK_PHRASES = ["Spoke to borrower", "Spoke to family member", "Asked to visit the branch",
  "Explained penal interest", "Number not reachable", "Will come with full amount"];

const typeLabel = Object.fromEntries(TYPES), channelLabel = Object.fromEntries(CHANNELS),
      outcomeLabel = Object.fromEntries(OUTCOMES);
export const labelType = (k) => typeLabel[k] || k || "—";
export const labelChannel = (k) => channelLabel[k] || k || "—";
export const labelOutcome = (k) => outcomeLabel[k] || String(k || "—").replace(/_/g, " ");

// ————————————————————————— dates —————————————————————————
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function addDays(iso, n) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  const da = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const db = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((db - da) / 86400000);
}
/** The tab's "When" presets → a from/to pair. */
export function presetRange(preset, today) {
  switch (preset) {
    case "missed":   return { from: "1970-01-01", to: addDays(today, -1) };
    case "today":    return { from: today, to: today };
    case "tomorrow": return { from: addDays(today, 1), to: addDays(today, 1) };
    case "week":     return { from: today, to: addDays(today, 6) };
    default:         return { from: today, to: today };
  }
}

/** Where a due date stands against today. */
export function dueStatus(dueOn, today) {
  if (!dueOn) return null;
  const d = daysBetween(today, String(dueOn).slice(0, 10));
  if (d < 0) return { state: "missed", days: -d, label: `missed ${-d}d` };
  if (d === 0) return { state: "today", days: 0, label: "today" };
  if (d === 1) return { state: "tomorrow", days: 1, label: "tomorrow" };
  return { state: "upcoming", days: d, label: `in ${d} days` };
}

/**
 * A promise to pay, judged against the receipts: KEPT when any receipt landed
 * between the promise and the promised date (inclusive), BROKEN once the date
 * is past with nothing, OPEN until then. Receipts: [{ business_date }].
 */
export function ptpStatus({ ptpDate, loggedOn, receipts = [], today }) {
  if (!ptpDate) return null;
  const by = String(ptpDate).slice(0, 10), from = String(loggedOn).slice(0, 10);
  const paid = receipts.some(r => { const d = String(r.business_date).slice(0, 10); return d >= from && d <= by; });
  if (paid) return "kept";
  return by < today ? "broken" : "open";
}

/**
 * What the system itself suggests for a running loan that has NO open due
 * item. Each returns a type and a reason, or nothing.
 *  · interest unpaid 30+ days (the clock the engine already keeps)
 *  · tenure within 15 days → renewal
 *  · past tenure + grace with penal running and no notice yet → overdue
 *  · a promise that was broken and nobody followed → ptp
 */
export function suggestFor({ unpaidDays = 0, ageDays = 0, tenureDays = Infinity, graceDays = 0,
                             noticeSent = false, brokenPtp = false, hasOpenDue = false }) {
  if (hasOpenDue) return null;
  if (brokenPtp) return { type: "ptp", reason: "a promise to pay was broken and nothing followed" };
  if (Number.isFinite(tenureDays) && ageDays > tenureDays + graceDays && !noticeSent)
    return { type: "overdue", reason: "past tenure + grace with penal running — no notice sent" };
  if (Number.isFinite(tenureDays) && tenureDays - ageDays >= 0 && tenureDays - ageDays <= 15)
    return { type: "renewal", reason: `tenure ends in ${tenureDays - ageDays} day${tenureDays - ageDays === 1 ? "" : "s"}` };
  if (unpaidDays >= 30) return { type: "interest", reason: `interest unpaid ${unpaidDays} days` };
  return null;
}

// ————————————————————————— saving —————————————————————————
/**
 * Validate and normalise a follow-up being logged. `outcomes` = the DB enum
 * labels (so a value the database does not know is refused here first).
 */
export function validFollowUp(b = {}, outcomes = [], today) {
  const problems = [];
  const type = String(b.type || "");
  const channel = String(b.channel || "");
  const outcome = String(b.outcome || "");
  if (!typeLabel[type]) problems.push("Pick what the follow-up is about");
  if (!channelLabel[channel]) problems.push("Pick how the customer was reached");
  if (!outcomes.includes(outcome)) problems.push("Pick what happened");
  const remark = String(b.remark ?? b.narration ?? "").trim().slice(0, 1000) || null;
  const t = String(today);
  let ptpDate = null, ptpAmountPaise = null;
  if (outcome === "promised") {
    ptpDate = ISO.test(String(b.ptpDate || "")) ? String(b.ptpDate) : null;
    if (!ptpDate) problems.push("A promise needs the date it was promised for");
    else if (ptpDate < t) problems.push("A promise-to-pay date cannot be in the past");
    const amt = Math.round(Number(b.ptpAmountPaise || 0));
    ptpAmountPaise = amt > 0 ? amt : null;
  }
  let nextFollowUp = null, nextType = null, assignedTo = null;
  if (b.nextFollowUp) {
    nextFollowUp = ISO.test(String(b.nextFollowUp)) ? String(b.nextFollowUp) : null;
    if (!nextFollowUp) problems.push("The next follow-up date is not a date");
    else if (nextFollowUp < t) problems.push("The next follow-up cannot be in the past");
    nextType = typeLabel[b.nextType] ? b.nextType : (outcome === "promised" ? "ptp" : type);
    assignedTo = Number(b.assignedTo) > 0 ? Number(b.assignedTo) : null;
  }
  return { ok: problems.length === 0, problems, type, channel, outcome, remark,
    ptpDate, ptpAmountPaise, nextFollowUp, nextType, assignedTo };
}

/** The pre-filled WhatsApp link for a reminder (no provider needed — opens the app). */
export function whatsappLink(mobile, text) {
  const digits = String(mobile || "").replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return `https://wa.me/91${digits}?text=${encodeURIComponent(text || "")}`;
}

/**
 * Group rows into the bands the tab shows. Suggested rows (kind "suggested")
 * keep the order the ranking gave them, in their own band after Today.
 */
export function groupByDay(rows, today) {
  const g = { missed: [], today: [], suggested: [], tomorrow: [], later: [] };
  for (const r of rows) {
    if (r.kind === "suggested") { g.suggested.push(r); continue; }
    const s = dueStatus(r.dueOn, today);
    if (!s) continue;
    (g[s.state === "upcoming" ? "later" : s.state]).push(r);
  }
  for (const k of ["missed", "today", "tomorrow", "later"]) g[k].sort((a, b) => String(a.dueOn).localeCompare(String(b.dueOn)) || String(a.loanNo).localeCompare(String(b.loanNo)));
  return g;
}

/**
 * How many suggestions the tab shows, and in what order. A gold-loan book has
 * hundreds of loans with interest unpaid 30+ days — the list is a SHORTLIST,
 * never the whole book: broken promises first, then past-tenure files with no
 * notice, then renewals falling due, then the longest-unpaid interest.
 * `cands` carry cheap database proxies (days since the last receipt stands in
 * for the engine's unpaid days); the engine prices only the shortlist.
 */
export const SUGGESTION_LIMIT = 30;
const SUGGESTION_ORDER = { ptp: 0, overdue: 1, renewal: 2, interest: 3 };
export function rankSuggestions(cands, limit = SUGGESTION_LIMIT) {
  const ranked = [];
  for (const c of cands) {
    const s = suggestFor({ unpaidDays: c.proxyDays, ageDays: c.ageDays, tenureDays: c.tenureDays, graceDays: c.graceDays,
      noticeSent: c.noticeSent, brokenPtp: c.brokenPtp, hasOpenDue: false });
    if (s) ranked.push({ ...c, rank: SUGGESTION_ORDER[s.type] ?? 9, type: s.type });
  }
  ranked.sort((a, b) => a.rank - b.rank || b.proxyDays - a.proxyDays || String(a.loanNo || a.id).localeCompare(String(b.loanNo || b.id)));
  return { total: ranked.length, shortlist: ranked.slice(0, limit) };
}
