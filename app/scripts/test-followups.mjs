/** Tests: the follow-up rules (src/lib/followups.js). No database. */
import { TYPES, CHANNELS, OUTCOMES, labelType, labelChannel, labelOutcome, addDays, daysBetween,
         presetRange, dueStatus, ptpStatus, suggestFor, validFollowUp, whatsappLink, groupByDay,
         rankSuggestions, SUGGESTION_LIMIT }
  from "../src/lib/followups.js";
let pass = 0, fail = 0;
const eq = (n, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log("  ✗", n, "— got", JSON.stringify(got), "want", JSON.stringify(want))); };
const T = "2026-10-15";
const ENUM = ["no_answer", "promised", "disputed", "paid", "wrong_number", "other", "will_renew", "not_at_home", "notice_sent"];

console.log("§1 labels");
eq("7 types", TYPES.length, 7); eq("7 channels", CHANNELS.length, 7); eq("9 outcomes", OUTCOMES.length, 9);
eq("type label", labelType("ptp"), "PTP check"); eq("channel label", labelChannel("ai_call"), "AI voice call");
eq("outcome label", labelOutcome("not_at_home"), "Not at home"); eq("unknown outcome reads plainly", labelOutcome("some_thing"), "some thing");
eq("every outcome key is in the DB enum", OUTCOMES.every(([k]) => ENUM.includes(k)), true);

console.log("§2 dates");
eq("addDays across month end", addDays("2026-10-30", 3), "2026-11-02");
eq("daysBetween", daysBetween("2026-10-13", T), 2);
eq("preset today", presetRange("today", T), { from: T, to: T });
eq("preset tomorrow", presetRange("tomorrow", T), { from: "2026-10-16", to: "2026-10-16" });
eq("preset week = 7 days incl today", presetRange("week", T), { from: T, to: "2026-10-21" });
eq("preset missed ends yesterday", presetRange("missed", T).to, "2026-10-14");

console.log("§3 due status");
eq("missed 6d", dueStatus("2026-10-09", T), { state: "missed", days: 6, label: "missed 6d" });
eq("today", dueStatus(T, T).state, "today");
eq("tomorrow", dueStatus("2026-10-16", T).state, "tomorrow");
eq("in 5 days", dueStatus("2026-10-20", T), { state: "upcoming", days: 5, label: "in 5 days" });
eq("none", dueStatus(null, T), null);

console.log("§4 promise status");
const rc = [{ business_date: "2026-10-14" }];
eq("kept — receipt between promise and date", ptpStatus({ ptpDate: T, loggedOn: "2026-10-08", receipts: rc, today: T }), "kept");
eq("open — date not yet past, nothing paid", ptpStatus({ ptpDate: "2026-10-20", loggedOn: "2026-10-08", receipts: [], today: T }), "open");
eq("broken — date past, nothing paid", ptpStatus({ ptpDate: "2026-10-13", loggedOn: "2026-10-06", receipts: [], today: T }), "broken");
eq("a receipt BEFORE the promise does not count", ptpStatus({ ptpDate: "2026-10-13", loggedOn: "2026-10-06", receipts: [{ business_date: "2026-10-01" }], today: T }), "broken");
eq("a receipt on the promised day counts", ptpStatus({ ptpDate: "2026-10-13", loggedOn: "2026-10-06", receipts: [{ business_date: "2026-10-13" }], today: T }), "kept");
eq("no promise → null", ptpStatus({ ptpDate: null, loggedOn: T, receipts: rc, today: T }), null);

console.log("§5 suggestions");
eq("nothing while a due item is open", suggestFor({ unpaidDays: 200, hasOpenDue: true }), null);
eq("broken promise first", suggestFor({ brokenPtp: true, unpaidDays: 200 }).type, "ptp");
eq("past tenure+grace, no notice → overdue", suggestFor({ ageDays: 240, tenureDays: 185, graceDays: 7 }).type, "overdue");
eq("past tenure but notice already sent → falls through to interest", suggestFor({ ageDays: 240, tenureDays: 185, graceDays: 7, noticeSent: true, unpaidDays: 240 }).type, "interest");
eq("tenure in 12 days → renewal", suggestFor({ ageDays: 173, tenureDays: 185, graceDays: 7 }).type, "renewal");
eq("unpaid 30 days → interest", suggestFor({ unpaidDays: 30, ageDays: 30, tenureDays: 365 }).type, "interest");
eq("unpaid 29 days → nothing", suggestFor({ unpaidDays: 29, ageDays: 29, tenureDays: 365 }), null);
eq("scheme with no tenure never suggests overdue", suggestFor({ ageDays: 900, unpaidDays: 10 }), null);

console.log("§6 validation");
const base = { type: "ptp", channel: "call", outcome: "promised", remark: " Spoke to borrower ", ptpDate: "2026-10-20", ptpAmountPaise: 2000000, nextFollowUp: "2026-10-20", assignedTo: 11 };
const v = validFollowUp(base, ENUM, T);
eq("valid promise", v.ok, true); eq("remark trimmed", v.remark, "Spoke to borrower");
eq("next type defaults to ptp after a promise", v.nextType, "ptp"); eq("assignee kept", v.assignedTo, 11);
eq("promise needs a date", validFollowUp({ ...base, ptpDate: "" }, ENUM, T).problems[0], "A promise needs the date it was promised for");
eq("promise date not in the past", validFollowUp({ ...base, ptpDate: "2026-10-01" }, ENUM, T).ok, false);
eq("next date not in the past", validFollowUp({ ...base, nextFollowUp: "2026-10-01" }, ENUM, T).ok, false);
eq("unknown type refused", validFollowUp({ ...base, type: "xyz" }, ENUM, T).ok, false);
eq("unknown channel refused", validFollowUp({ ...base, channel: "pigeon" }, ENUM, T).ok, false);
eq("outcome the DB does not know is refused", validFollowUp({ ...base, outcome: "will_renew" }, ENUM.slice(0, 6), T).ok, false);
const noNext = validFollowUp({ type: "interest", channel: "whatsapp", outcome: "no_answer" }, ENUM, T);
eq("no next step → nulls", [noNext.ok, noNext.nextFollowUp, noNext.nextType, noNext.ptpDate], [true, null, null, null]);
const nextOnly = validFollowUp({ type: "interest", channel: "call", outcome: "no_answer", nextFollowUp: "2026-10-18" }, ENUM, T);
eq("next type defaults to this type", nextOnly.nextType, "interest");
eq("ptp amount ignored unless promised", validFollowUp({ type: "interest", channel: "call", outcome: "paid", ptpAmountPaise: 500 }, ENUM, T).ptpAmountPaise, null);

console.log("§7 misc");
eq("whatsapp link", whatsappLink("6000001540", "Hi"), "https://wa.me/916000001540?text=Hi");
eq("bad mobile → null", whatsappLink("12", "Hi"), null);
const g = groupByDay([{ dueOn: "2026-10-09", loanNo: "B" }, { dueOn: T, loanNo: "A" }, { dueOn: "2026-10-16", loanNo: "C" },
  { dueOn: "2026-10-20", loanNo: "D" }, { dueOn: "2026-10-13", loanNo: "A" }], T);
eq("grouped and sorted", [g.missed.map(r => r.loanNo), g.today.length, g.tomorrow.length, g.later.length], [["B", "A"], 1, 1, 1]);
const g2 = groupByDay([{ dueOn: T, loanNo: "Z", kind: "suggested" }, { dueOn: T, loanNo: "A" }, { dueOn: T, loanNo: "B", kind: "suggested" }], T);
eq("suggested rows keep their own band, in the order given", [g2.today.map(r => r.loanNo), g2.suggested.map(r => r.loanNo)], [["A"], ["Z", "B"]]);

console.log("§8 suggestion shortlist");
const c = (id, o) => ({ id, loanNo: "L" + id, proxyDays: 0, ageDays: 0, tenureDays: 365, graceDays: 7, noticeSent: false, brokenPtp: false, ...o });
const rk = rankSuggestions([c(1, { proxyDays: 40 }), c(2, { proxyDays: 400, ageDays: 400 }), c(3, { brokenPtp: true, proxyDays: 5 }),
  c(4, { ageDays: 355 }), c(5, { proxyDays: 90 }), c(6, { proxyDays: 10 }), c(7, { proxyDays: 400, ageDays: 400, noticeSent: true })]);
eq("order: broken PTP, past tenure w/o notice, renewal, longest unpaid; too-fresh dropped",
  rk.shortlist.map(r => r.id), [3, 2, 4, 7, 5, 1]);
eq("types on the shortlist", rk.shortlist.map(r => r.type), ["ptp", "overdue", "renewal", "interest", "interest", "interest"]);
eq("total counts every candidate that qualifies", rk.total, 6);
const many = Array.from({ length: 200 }, (_, i) => c(i, { proxyDays: 30 + i }));
const rk2 = rankSuggestions(many);
eq("capped at the limit, total still the whole set", [rk2.shortlist.length, rk2.total, rk2.shortlist[0].proxyDays], [SUGGESTION_LIMIT, 200, 229]);
eq("limit is an argument", rankSuggestions(many, 5).shortlist.length, 5);

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
