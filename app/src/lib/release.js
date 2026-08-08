/**
 * SLF GoldDesk — RELEASE RULES
 *
 * Gold must go back to the borrower within 7 WORKING days of closure.
 * Pure functions; holiday dates come in as arguments.
 *
 * Locked with the owner (27 Jul 2026): release is to the BORROWER ONLY.
 * `collectedBy` exists so a relative path can be added later as an extension,
 * but today any value other than "borrower" is refused.
 */

export const SLA_WORKING_DAYS = 7;

/** Sundays and listed holidays are not working days. */
export function isWorkingDay(iso, holidays = []) {
  const d = new Date(iso + "T00:00:00Z");
  if (d.getUTCDay() === 0) return false;                 // Sunday
  return !holidays.includes(iso);
}

/**
 * Which working day of the SLA today is, counting the first working day on or
 * after closure as day 1. A loan closed on Saturday and collected on Monday is
 * on day 1, not day 3.
 */
export function slaDay(closedAt, today, holidays = []) {
  let day = 0;
  const d = new Date(closedAt + "T00:00:00Z");
  const end = new Date(today + "T00:00:00Z");
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10);
    if (isWorkingDay(iso, holidays)) day++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return Math.max(1, day);
}

/** The three bands on the list screen — exactly the frozen UX's bandOf(). */
export function slaBand(day) {
  return day >= 7 ? "Day 7+" : day >= 5 ? "Day 5–6" : "Within SLA";
}

/**
 * May this gold be handed over?
 * @param {{loanStatus:string, packetStatus:string, identityOk:boolean,
 *          sealOk:boolean, handoverPhotoId:number|null, collectedBy:string}} c
 */
export function releaseReady(c = {}) {
  const problems = [];
  if (c.loanStatus === "active")
    problems.push("This loan is still running — gold is released only after full settlement");
  else if (c.loanStatus !== "closed")
    problems.push(`This loan is ${c.loanStatus} — its gold does not go back over the counter`);
  if (c.packetStatus === "out")
    problems.push("This packet has already left the vault");
  if (c.packetStatus === "frozen")
    problems.push("This packet is frozen after a mismatch — Head Office must clear it before release");
  if ((c.collectedBy || "borrower") !== "borrower")
    problems.push("Only the borrower may collect — release to a relative is not yet permitted");
  if (!c.identityOk)
    problems.push("Confirm the borrower's identity was re-verified against the loan photo");
  if (!c.sealOk)
    problems.push("Confirm the seal was shown intact and opened in front of the borrower");
  if (!c.handoverPhotoId)
    problems.push("Capture the acknowledgement and handover photograph");
  return { ok: problems.length === 0, problems };
}

/** The Marathi WhatsApp text shown for copying — no sending happens. */
export function releaseWhatsapp({ customerName, grams, loanNo }) {
  const first = String(customerName || "").split(" ")[0];
  return `नमस्कार ${first} जी, तुमचे सोने (${grams} ग्रॅम) आज सुपूर्द करण्यात आले. ` +
    `कर्ज ${loanNo} पूर्ण बंद. NOC सोबत जोडले आहे. — S Lunawat Finance`;
}
