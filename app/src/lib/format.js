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
