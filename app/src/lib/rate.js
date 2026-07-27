/**
 * SLF GoldDesk — daily rate rules.
 *
 * Owner decisions (Jul 2026):
 *  · A rate is published by ONE person; no second signature.
 *  · A rate is NOT published daily. It carries forward until it is changed —
 *    a rate entered on the 12th is still the rate in force on the 20th.
 *  · A large move must be confirmed on screen, because a typo in this one
 *    field mis-prices every loan taken that day.
 */

/** How far the new rate moves from the one currently in force, as a percentage. */
export function jumpPct(newPaise, currentPaise) {
  if (!currentPaise) return 0;
  return ((newPaise - currentPaise) / currentPaise) * 100;
}

/**
 * Should the screen stop and ask "are you sure?"
 * @returns {{needsConfirm:boolean, pct:number, direction:'up'|'down'|'same', message:string|null}}
 */
export function sanityCheck(newPaise, currentPaise, warnPct = 5) {
  const pct = jumpPct(newPaise, currentPaise);
  const abs = Math.abs(pct);
  const direction = pct > 0 ? "up" : pct < 0 ? "down" : "same";
  if (!currentPaise || abs <= warnPct) return { needsConfirm: false, pct, direction, message: null };
  const f = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
  return {
    needsConfirm: true, pct, direction,
    message: `That is ${abs.toFixed(1)}% ${direction} from ${f(currentPaise)}. ` +
             `Check the figure — every loan taken today is priced from it.`,
  };
}

/** The funding rate must sit below the market rate — that gap is our protection. */
export function validRatePair(marketRupees, fundingRupees) {
  const m = plausible(marketRupees);
  if (!m.ok) return { ok: false, field: "market", reason: m.reason };
  const f = plausible(fundingRupees);
  if (!f.ok) return { ok: false, field: "funding", reason: f.reason };
  if (Number(fundingRupees) > Number(marketRupees))
    return { ok: false, field: "funding",
             reason: "The funding rate cannot be above the market rate — we would lend more than the gold is worth" };
  const pct = ((marketRupees - fundingRupees) / marketRupees) * 100;
  return { ok: true, haircutPct: pct,
           note: pct === 0 ? "no haircut — we lend at full market value"
                 : `margin ₹${Math.round(marketRupees - fundingRupees).toLocaleString("en-IN")}/g · ${pct.toFixed(1)}% haircut before the scheme's funding % applies` };
}

/** Obvious nonsense that should never reach the database. */
export function plausible(rupeesPerGram) {
  const n = Number(rupeesPerGram);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "Enter the 24K rate in rupees per gram" };
  if (n < 1000) return { ok: false, reason: "That looks too low for 24K gold — check the figure" };
  if (n > 100000) return { ok: false, reason: "That looks too high for 24K gold — check the figure" };
  return { ok: true };
}

/** How the header should describe the rate in force. */
export function rateLabel(rateDate, today) {
  if (!rateDate) return { state: "none", text: "rate not set — lending locked" };
  if (rateDate === today) return { state: "today", text: "published today" };
  const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const days = Math.round((d(today) - d(rateDate)) / 86400000);
  return { state: "carried", days,
    text: `carried forward from ${rateDate.slice(8, 10)}-${rateDate.slice(5, 7)}-${rateDate.slice(0, 4)}` +
          ` · ${days} day${days === 1 ? "" : "s"} ago` };
}
