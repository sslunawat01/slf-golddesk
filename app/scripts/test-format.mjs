import { formatAadhaar, cleanAadhaar, maskAadhaar, formatPan, formatMobile, formatIfsc, titleCaseName } from "../src/lib/format.js";
let pass=0, fail=0;
const eq=(n,g,w)=>{const ok=g===w;ok?(pass++,console.log("  ✓",n)):
  (fail++,console.log("  ✗",n,"\n      got ",JSON.stringify(g),"\n      want",JSON.stringify(w)));};

console.log("\n§1 Aadhaar spacing");
eq("groups of four", formatAadhaar("868778686868"), "8687 7868 6868");
eq("partial entry spaces as you type", formatAadhaar("86877"), "8687 7");
eq("existing spaces are re-normalised", formatAadhaar("8687 7868 6868"), "8687 7868 6868");
eq("letters ignored", formatAadhaar("86a8b778686868"), "8687 7868 6868");
eq("never longer than 12 digits", cleanAadhaar("8687786868689999"), "868778686868");
eq("stored value has no spaces", cleanAadhaar("8687 7868 6868"), "868778686868");
eq("masked for display", maskAadhaar("6868"), "XXXX XXXX 6868");

console.log("\n§2 PAN shape BHKYT2345M");
eq("valid PAN kept", formatPan("BHKYT2345M"), "BHKYT2345M");
eq("lowercase raised", formatPan("bhkyt2345m"), "BHKYT2345M");
eq("digits refused in the first five", formatPan("BH1KYT2345M"), "BHKYT2345M");
eq("letters refused in the number block", formatPan("BHKYTA2345M"), "BHKYT2345M");
eq("spaces and dashes dropped", formatPan("BHKYT-2345 M"), "BHKYT2345M");
eq("stops at ten characters", formatPan("BHKYT2345MZZZ"), "BHKYT2345M");
eq("partial entry allowed", formatPan("BHK"), "BHK");

console.log("\n§3 Mobile");
eq("five-five grouping", formatMobile("9822011223"), "98220 11223");
eq("partial", formatMobile("98220"), "98220");
eq("caps at ten digits", formatMobile("98220112239999"), "98220 11223");

console.log("\n§4 IFSC");
eq("uppercased", formatIfsc("kkbk0001896"), "KKBK0001896");
eq("symbols dropped", formatIfsc("KKBK-0001896"), "KKBK0001896");


console.log("\n§6 A customer's name stores the same way however it was typed");
{
  eq("all lower case", titleCaseName("naveen goyal"), "Naveen Goyal");
  eq("all upper case", titleCaseName("PRATHMESH HANUMANTA KASAR"), "Prathmesh Hanumanta Kasar");
  eq("jumbled case", titleCaseName("nAVEEN gOYAL"), "Naveen Goyal");
  eq("already correct is left alone", titleCaseName("Komal Balasaheb Mali"), "Komal Balasaheb Mali");
  eq("spaces at the ends are trimmed", titleCaseName("  sarita   patil  "), "Sarita Patil");
  eq("an initial keeps its dot and its capital", titleCaseName("s. lunawat"), "S. Lunawat");
  eq("hyphenated names capitalise both parts", titleCaseName("ram-krishna"), "Ram-Krishna");
  eq("an apostrophe capitalises what follows", titleCaseName("d'souza"), "D'Souza");
  eq("a single letter still works", titleCaseName("v"), "V");
  eq("empty stays empty", titleCaseName(""), "");
  eq("nothing at all stays empty", titleCaseName(null), "");
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
