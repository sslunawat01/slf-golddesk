/**
 * SLF GoldDesk — on-screen formatting for identity numbers.
 * Display carries the spacing a clerk expects; storage stays clean digits.
 */

/** 868778686868 → "8687 7868 6868" (groups of four, as printed on the card). */
export const formatAadhaar = (v) =>
  String(v || "").replace(/\D/g, "").slice(0, 12).replace(/(\d{4})(?=\d)/g, "$1 ").trim();
export const cleanAadhaar = (v) => String(v || "").replace(/\D/g, "").slice(0, 12);

/** Masked for display once saved — we never show a full Aadhaar back. */
export const maskAadhaar = (last4) => last4 ? `XXXX XXXX ${last4}` : "—";

/** PAN is five letters, four digits, one letter: BHKYT2345M. */
export function formatPan(v) {
  const raw = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let out = "";
  for (const c of raw) {
    if (out.length >= 10) break;
    const pos = out.length;                              // decide by OUTPUT position
    const wantLetter = pos < 5 || pos === 9;             // 5 letters · 4 digits · 1 letter
    if (wantLetter ? /[A-Z]/.test(c) : /\d/.test(c)) out += c;
  }
  return out;
}

/** 9822011223 → "98220 11223" — how Indian mobiles are read aloud. */
export const formatMobile = (v) => {
  const d = String(v || "").replace(/\D/g, "").slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
};
export const cleanDigits = (v) => String(v || "").replace(/\D/g, "");

/** IFSC: four letters, a zero, then six characters. */
export const formatIfsc = (v) =>
  String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);

/**
 * Names are stored in one shape, however they were typed.
 * "naveen goyal", "NAVEEN GOYAL" and "nAVEEN gOYAL" all store as "Naveen Goyal".
 *
 * Kept deliberately simple and predictable:
 *  · each word starts capital, the rest lowercase
 *  · parts joined by - or ' are each capitalised — ram-krishna → Ram-Krishna, d'souza → D'Souza
 *  · initials keep their dot and their capital — s. lunawat → S. Lunawat
 *  · runs of spaces collapse to one, and the ends are trimmed
 *
 * It does NOT try to be clever about McDonald or DeSouza — a clerk can always
 * correct the field afterwards, and a rule nobody can predict is worse than none.
 */
export function titleCaseName(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(word => word
      .split(/([-'])/)                       // keep the separators
      .map(part => (part === "-" || part === "'") ? part
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(""))
    .join(" ");
}


/**
 * E17 №3 (owner, 29 Aug 2026): amounts must read like a person says them —
 * Indian system, lakh and crore. Whole rupees only (paise ignored for speech).
 * rupeesInWords(2000000) → "twenty lakh"
 */
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function twoDigits(n) {
  return n < 20 ? ONES[n] : (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
}
function threeDigits(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [(h ? ONES[h] + " hundred" : ""), twoDigits(r)].filter(Boolean).join(" ");
}
export function rupeesInWords(rupees) {
  let n = Math.floor(Math.abs(Number(rupees) || 0));
  if (n === 0) return "zero";
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push((crore > 99 ? rupeesInWords(crore) : twoDigits(crore)) + " crore");
  if (lakh) parts.push(twoDigits(lakh) + " lakh");
  if (thousand) parts.push(twoDigits(thousand) + " thousand");
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
}
