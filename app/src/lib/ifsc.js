/**
 * SLF GoldDesk — IFSC lookup.
 * Razorpay's public IFSC service (no key, no cost), cached into ifsc_directory
 * so a branch's regular banks resolve instantly and keep working offline.
 */
import { one, q } from "./db.js";
const API = "https://ifsc.razorpay.com/";
const TIMEOUT_MS = 4000;

export async function lookupIfsc(ifsc) {
  const code = String(ifsc || "").toUpperCase().trim();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) return null;

  const cached = await one(
    `SELECT ifsc, bank, branch_name AS "branchName", address, city, state
       FROM ifsc_directory WHERE ifsc = $1`, [code]);
  if (cached) return { ...cached, source: "cache" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API + code, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d?.BANK) return null;
    const row = { ifsc: code, bank: d.BANK, branchName: d.BRANCH || "",
      address: d.ADDRESS || "", city: d.CITY || d.DISTRICT || "", state: d.STATE || "" };
    await one(
      `INSERT INTO ifsc_directory (ifsc, bank, branch_name, address, city, state)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (ifsc) DO NOTHING RETURNING ifsc`,
      [row.ifsc, row.bank, row.branchName, row.address, row.city, row.state]).catch(() => null);
    return { ...row, source: "api" };
  } catch { return null; }
  finally { clearTimeout(t); }
}
