import { classifyWho, newOtp, judgeAttempt, maskName,
         OTP_TTL_MS, OTP_MAX_ATTEMPTS } from "../src/lib/forgotpw.js";

let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log("  ✓", n)) : (fail++, console.log("  ✗", n)); };
const eq = (n, g, w) => { const k = JSON.stringify(g) === JSON.stringify(w);
  k ? (pass++, console.log("  ✓", n)) :
    (fail++, console.log("  ✗", n, "got", JSON.stringify(g), "want", JSON.stringify(w))); };

console.log("\n§1 Who is asking — mobile vs username");
eq("a 10-digit mobile starting 9 is a mobile", classifyWho("9822012345"),
  { ok: true, kind: "mobile", value: "9822012345" });
eq("spaces and dashes in a mobile are forgiven", classifyWho(" 98220-12345 ").value, "9822012345");
eq("a mobile starting 5 is treated as a username", classifyWho("5822012345").kind, "username");
eq("a username is lower-cased", classifyWho("SaritaP").value, "saritap");
ok("an emp code like EMP0004 rides the username lane", classifyWho("EMP0004").kind === "username");
ok("empty input is refused", classifyWho("  ").ok === false);
ok("two characters are refused as too short", classifyWho("ab").ok === false);

console.log("\n§2 The code itself");
ok("always 6 digits — floor of the range", newOtp(() => 0) === "100000");
ok("always 6 digits — top of the range", newOtp(() => 0.999999999) === "999999");

console.log("\n§3 Judging an entry attempt");
const now = 1_000_000;
const rec = () => ({ code: "123456", expiresAt: now + OTP_TTL_MS, attempts: 0 });
ok("no record means: ask for a code first", judgeAttempt(null, "123456", now).ok === false);
ok("the right code passes", judgeAttempt(rec(), "123456", now).ok === true);
ok("the right code with spaces around it passes", judgeAttempt(rec(), " 123456 ", now).ok === true);
{
  const r = judgeAttempt(rec(), "000000", now);
  ok("a wrong code is refused but the record lives", r.ok === false && r.dead === false);
  ok("the refusal says how many attempts are left", r.reason.includes("4 attempt"));
}
{
  const r = judgeAttempt({ ...rec(), attempts: OTP_MAX_ATTEMPTS - 1 }, "000000", now);
  ok("the fifth wrong try kills the record", r.dead === true);
}
{
  const r = judgeAttempt({ ...rec(), attempts: OTP_MAX_ATTEMPTS }, "123456", now);
  ok("even the right code after five wrong tries is dead", r.ok === false && r.dead === true);
}
{
  const r = judgeAttempt(rec(), "123456", now + OTP_TTL_MS + 1);
  ok("one millisecond past five minutes: expired and dead", r.ok === false && r.dead === true);
}
ok("exactly at the five-minute mark still passes",
  judgeAttempt(rec(), "123456", now + OTP_TTL_MS).ok === true);

console.log("\n§4 Masked name — confirm without leaking");
eq("a two-word name keeps first two and last letters", maskName("Sarita Patil"), "Sa•••a Pa••l");
eq("a one-letter initial survives untouched", maskName("S Lunawat"), "S Lu••••t");
eq("empty stays empty", maskName(""), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
