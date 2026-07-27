/**
 * SLF GoldDesk — pincode lookup.
 *
 * Source of truth is India Post's public postal API (no key, no cost).
 * Every successful lookup is cached into `pincode_directory`, so:
 *   · the second customer from the same pincode never waits,
 *   · the branch keeps working if the internet drops,
 *   · we build our own directory of the areas we actually lend in.
 */
import { one, q } from "./db.js";

const API = "https://api.postalpincode.in/pincode/";
const TIMEOUT_MS = 4000;

/** Cached first, then the API. Returns null when the pincode does not exist. */
export async function lookupPincode(pincode) {
  if (!/^[1-9]\d{5}$/.test(String(pincode || ""))) return null;

  const cached = await q(
    `SELECT area, taluka, district, state FROM pincode_directory WHERE pincode = $1`, [pincode]);
  if (cached.length) return { pincode, source: "cache", options: cached, ...cached[0] };

  const rows = await fetchIndiaPost(pincode);
  if (!rows?.length) return null;

  for (const r of rows) {
    await one(
      `INSERT INTO pincode_directory (pincode, area, taluka, district, state, source)
       VALUES ($1,$2,$3,$4,$5,'india-post') ON CONFLICT (pincode) DO NOTHING RETURNING pincode`,
      [pincode, r.area, r.taluka, r.district, r.state]).catch(() => null);
  }
  return { pincode, source: "india-post", options: rows, ...rows[0] };
}

async function fetchIndiaPost(pincode) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API + pincode, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = await res.json();
    const block = Array.isArray(body) ? body[0] : null;
    if (!block || block.Status !== "Success" || !Array.isArray(block.PostOffice)) return null;

    // One pincode often covers several post offices; keep them all, best first.
    const seen = new Set();
    return block.PostOffice.map(po => ({
      area: po.Name, taluka: po.Block && po.Block !== "NA" ? po.Block : po.Taluk || po.Division || "",
      district: po.District, state: po.State,
    })).filter(r => {
      const k = r.area + "|" + r.taluka;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
  } catch { return null; }       // offline or slow: caller falls back to manual entry
  finally { clearTimeout(t); }
}
