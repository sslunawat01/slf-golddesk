# SLF GoldDesk — Decision Record
**Every decision made, and why.** For S Lunawat Finance (NBFC, Bhagur/Nashik).
Last updated: 28 July 2026 · Keep this file with the code; it is the constitution.

---

## 1 · Product

| # | Decision | Note |
|---|---|---|
| P1 | Build a gold-loan system from scratch, replacing the 2015 vendor product (Maraekat) | Rules become data, not code |
| P2 | Two front doors, one database: **Counter** (branch) and **HQ** (head office) | Same codebase |
| P3 | **Search is the front door** — no browsable lists of active loans | A branch carries 1000+ loans |
| P4 | Home shows work-in-progress + deadline queues only; queues hide when empty | The system drives the work |
| P5 | UX frozen in Claude Design first, then built | **The frozen `.dc.html` is the truth** — it beats written specs wherever they disagree. Where the schema and the frozen UX disagree, the difference is put to the owner, never silently chosen |
| P6 | Target scale: 200–400 branches, 1M+ customers, 10M+ loans over ten years | Modest for Postgres; the constraint is operations, not throughput |

---

## 2 · The interest engine (locked with the owner, July 2026)

These are the rules money is made by. Changing one requires a written owner decision.
The engine lives at **`src/lib/engine.js`** (moved into the app 28 Jul) with **55 golden tests**
at `scripts/test-engine.mjs` that run on every deploy.

| # | Rule | Detail |
|---|---|---|
| R-A | **Day divisor comes from the scheme** (`days_in_year`, 365 today) | Never the calendar; leap years irrelevant |
| R-B | **Slabs are retroactive within a cycle** | The slab the cycle's age reaches prices *all* its days. `prospective` exists as scheme config |
| R-C | **Cycles are anchored by interest payments** | A payment clearing all interest due seals that period and restarts the slab clock. Partial payments reduce dues but never move the anchor. Penal has its own anchor. **See R-E for where the clock restarts when the minimum floor was applied** |
| R-D | **Round UP to the next ₹10.** Interest and penal round once on their own totals. **CHARGES ROUND INDIVIDUALLY** *(amended by owner, 28 Jul 2026 — previously the charges total rounded once)* | ₹118 + ₹112 bills as **₹120 + ₹120 = ₹240**, not ₹230. Each charge's payable figure is fixed at its own rounded amount, so a part payment never rounds twice. The round-up posts to **Rounding income**; the exact GST split underneath stays untouched |
| R-D2 | **Charges are NEVER deducted at disbursement** *(owner, 27 Jul 2026)* | The customer receives the **full sanctioned amount**. The processing charge is raised on the loan at activation and collected at the first repayment, where appropriation puts charges first. **Live and verified: loans 01A6702302/03 paid out in full** |
| R-E | **Minimum interest is a lifetime floor applied at EVERY payment** *(amended by owner, 28 Jul 2026 — the earlier "closure-only" reading was wrong)* | `min_interest_days` (15). A loan's first interest payment is topped up to the minimum if short — even a same-day repayment pays 15 days. Because the floor is on *lifetime* interest it can bind only once per loan. **Paying the floor buys DAYS, not a reset**: the cycle anchor moves to disbursement + 15 days, so a customer who paid on day 3 and returns on day 20 owes 5 days, never 17. The screen names the date the customer is covered to |
| R-F | **Settlement = principal + interest + penal + charges**, each already rounded | No second rounding |
| R-G | **Appropriation order: charges → penal → interest → principal** | The repayment screen shows the live split, including a To-penal line when penal runs |
| R-H | **Capitalization only at renewal**, by human choice, scheme-gated | Interest never compounds automatically |
| R-I | **Penal = % p.a. on overdue principal from tenure end.** Grace **forgives entirely** if closed within tenure+grace; past that, penal runs **from tenure end** (grace days counted, not skipped) | ⚠ **Under owner review**: loans seeded at day 372 (no penal) and day 380 (penal from day 365) demonstrate the cliff — one day late costs eight days of penal. Verdict pending; the rule stands until changed |
| R-J | **Principal is a multiple of ₹100**; payments minimum ₹100 in ₹10 steps | Exact settlement always accepted. Enforced twice: in the engine and by a CHECK on `receipt` |
| **R-K** | **A receipt is dated today, always. Backdating is impossible** *(owner, 28 Jul 2026)* | The receipt API has no date field; `business_date` is the database's own CURRENT_DATE. A backdated payment would silently reduce interest and break day-end reconciliation. If a genuine need ever arises it will be a separate HO action with its own approval, never a counter capability |

**Figures that must never change** (enforced by the golden tests):
Prathmesh ₹1,00,000 SB-IND04 day 80 → **₹3,950** · Komal ₹20,000 day 33 → **₹370** ·
Archana ₹50,000 day 5: **₹420 whether interim or closing** (R-E amended; the old ₹140 interim figure is gone) ·
day-3 floor payment on ₹40,000 @ 20% → ₹330, and day 20 then owes **₹110 for 5 days**, the clock having moved to day 15 ·
cycle split (pay day 60, close day 80) → ₹2,470 + **₹830** · penal at day 190 / 193 / 250 → **₹0 / ₹50 / ₹360** ·
charges ₹118 + ₹112 → **₹240 billed, ₹10 to Rounding income**.

---

## 3 · Rates and valuation

| # | Decision | Detail |
|---|---|---|
| V1 | **Two rates per metal: market and funding** | Funding ≤ market, enforced by constraint |
| V2 | The gap is the **haircut, taken before the scheme's funding %** | e.g. 6.2% haircut + 70% scheme ≈ 65% of market |
| V3 | Rate/gram = rate × purity % (× scheme funding % for the lendable figure) | Verified against legacy: 12,100 × 83% × 70% = **₹7,030.10/g** |
| V4 | **Publishing is optional — a rate carries forward until changed** | Confirmed again by owner 28 Jul. ⚠ The pair in force is **₹12,300/₹12,300 — zero haircut**, flagged repeatedly; correction to 12,040/11,290 still pending |
| V5 | **One person sets the rate**, with a >5% sanity confirmation recorded on the row | |
| V6 | Market and funding shown **separately**, each rounded up to ₹100 | |
| V7 | Every application **snapshots both rates** | |
| V8 | **One rate pair per application, and it is the gold pair** | Silver rows refuse to price rather than borrow the gold rate — blocked on O7 |

---

## 4 · Customers and KYC

*(unchanged from 27 Jul — C1 through C12 as previously recorded)*

| # | Decision | Detail |
|---|---|---|
| C1 | **Five tabs**: Identity · Contact · Documents · Nominee · Loan settings | Bank accounts live inside Documents |
| C2 | **Aadhaar *or* PAN is enough** | The asterisk moves |
| C3 | A **verified Aadhaar also proves address** | With only PAN, one address document required |
| C4 | **GST optional for everyone** | |
| C5 | **KYC valid 3 years**; amber within 90 days; red blocks new lending | |
| C6 | **Zero on either limit ⇒ blacklisted**; narration mandatory | The seed script learned this the hard way — `max_outstanding_paise` defaults to 0, which reads as blacklisted |
| C7 | Mobile OTP manual until the SMS gateway exists | |
| C8 | Pincode → India Post API, cached | |
| C9 | IFSC → public IFSC API, cached | |
| C10 | Money only to a **verified** account, enforced by trigger | |
| C11 | Aadhaar/PAN/mobile display formatting only; storage clean | |
| C12 | **Names normalise to Title Case**; nominee and bank-holder names untouched | |

---

## 5 · Lending flow

| # | Decision | Detail |
|---|---|---|
| L1–L11 | *(unchanged — wizard, valuers, HO routing, deny-by-default sanction, photo set, cash limits, multi-account disbursement, print-after-activation)* | |
| L12 | Gold release within **7 working days**, three gates before handover | Now **built**: identity re-verified · seal intact, opened before the borrower · handover photo. All three enforced twice — in the API and by `release_check` in the database |
| **L12a** | **Working days = calendar days minus Sundays and the holiday table** *(28 Jul 2026)* | A loan closed on Sunday starts its SLA on Monday as day 1. List bands: Within SLA (1–4) · Day 5–6 amber · Day 7+ red |
| **L12b** | **Release is to the BORROWER ONLY** *(owner, 28 Jul 2026)* | A relative-collection path is anticipated — the API carries `collectedBy` — but today any value other than `borrower` is refused. When built, it will be its own designed flow with ID capture, not a checkbox |
| **L12c** | **A frozen packet never releases** | HO must clear the mismatch first. Loans `closed`-but-frozen appear on the release list with a red chip and no button |
| **L12d** | **Release issues an NOC number** from the gapless `noc` series (migration 011) | The printable NOC document itself arrives with print layouts |
| L13 | An approved application may not be edited, but must still be disbursable | |
| L14 | A pledge waiting at HO may be withdrawn by the branch (option B) | Migration 007 |
| **L15** | **The packet is born at disbursement**, unsealed, status `at_counter` *(28 Jul 2026)* | Sealing happens at vault-in the next working day. Every packet's whole life is now: at_counter → in_safe (→ frozen) → out |
| **L16** | **Vault-in mismatch (resolves O10)** *(owner accepted Claude's recommendation, 28 Jul 2026)* | A mismatch requires a reason from a fixed list, a narration of ≥10 characters and a photograph; it **freezes the packet**, writes **no** vault movement (the gold never entered a safe), and cannot be edited or deleted afterwards. Checks are now repeatable per packet — the original UNIQUE(packet_id) would have bricked a packet after one failed check. "Notify HO" today = the frozen packet appears on lists; real alerts come later |

---

## 6 · Access and security

*(A1–A8 unchanged: renamable roles, one server-side policy engine, DB sessions with sign-in
permission snapshots, scrypt, login windows + lockout, 2FA dormant, HQ-only user creation,
acting branch fixed at sign-in.)*

---

## 7 · Technical

*(T1–T12 unchanged: Next.js + PostgreSQL monolith, integer paise/milligrams, append-only facts,
derived values never stored, rules in the database, versioned schemes, structure-as-data,
forward-only migrations, device-side photo compression, EC2 Mumbai with RDS deferred until the
first real disbursement, deploy.sh, private GitHub.)*

Additions:

| # | Decision | Detail |
|---|---|---|
| **T13** | **The interest engine lives inside the app** (`src/lib/engine.js`) with its golden tests in `scripts/` | Moved 28 Jul, unchanged, so the tests run on every deploy instead of sitting outside where nothing checked them |
| **T14** | **A loan's position is replayed, never read from a stored total** | `src/lib/loanstate.js` rebuilds state from immutable receipts + charges on every visit. `loan_accrual_cache` is a cache, overwritten after each payment, rebuildable always. The payment endpoint re-prices from the replay and **ignores the amount the browser claims is due** |
| **T15** | **Test data carries the `Zztest` name prefix and `IND99` customer numbers** | Seeded: 6 customers, 8 loans aged 0–380 days exercising the floor, per-charge rounding, slabs, grace and penal. `purge-test-loans.sql` removes it all; it briefly disables the append-only triggers and must never be adapted for real data |

---

## 8 · Lessons written into the way we work

*(Lessons 1–11 unchanged.)* New:

12. **The schema is younger than the plan — read it before building on it.** *(28 Jul: `vault_in_check`'s UNIQUE constraint would have permanently bricked any packet with one failed check; caught by reading `\d` output, not by testing.)*
13. **Sequencing matters for backfills.** *(28 Jul: the packet backfill ran before the test-loan seed, so the seeded loans had no packets and the vault and release lists were empty. The backfill had to be re-run.)*
14. **When the owner's instruction contradicts a "locked" rule, the rule was wrong or the record was.** Either way it is an amendment, done once, with its consequence stated plainly before the code changes. *(28 Jul: R-E and R-D both amended this way.)*

---

## 9 · Still open — needs an owner decision

| # | Question | Blocks |
|---|---|---|
| O1 | **Top-up mechanics** | Sprint 3 |
| O2 | **Cash transfer authority** — who authorises, above what amount | Cash transfer screen |
| O3 | **Death-case legal chain** | Sprint 3 |
| O4 | **Cancellation after sanction** | Sprint 3 |
| O5 | **Print stationery** — A4 vs 80 mm, Marathi font | Print layouts |
| O6 | **B-book vs V-book** — what the two entity series are | Entity creation stays read-only in Settings until answered |
| O7 | **Silver** — its own rate pair and per-metal snapshot | Metal column exists; silver cannot price |
| O8 | **IBJA reference feed** | Rate screen |
| O9 | Slab-boundary warning at the counter? | Repayment polish |
| ~~O10~~ | ~~Vault-in mismatch~~ | **Resolved 28 Jul → L16** |
| O11 | **Bank-account verification screen** — no way to record a penny drop | Disbursement to any new customer's account |
| O12 | **Drawer cap** — owner asked what it is (28 Jul); decided to **leave the column NULL and off the branch form**. Final cap-or-no-cap decision deferred to day-end build | Day-end's excess-cash check only |
| **O13** | **Penal grace cliff (R-I)** — day 372 pays ₹0, day 373 pays 8 days | Owner has the two seeded loans to compare; verdict pending |

---

## 10 · ⚠ Testing weakenings that MUST be reversed before real staff use the system

Granted deliberately so the owner could test end to end. **None may survive into production.**

| # | What was granted | How to reverse |
|---|---|---|
| W1 | Counter Operator (role 3) `sanction` at `full` | `DELETE FROM role_permission WHERE role_id=3 AND fn='sanction';` then bump `perm_version` |
| W2 | `sanction_limit` for role 3 at ₹10,00,000 (TEMPORARY) | Delete the row |
| W3 | `sanction_limit` for role 4 (Valuer) at ₹10,00,000 (TEMPORARY) | Delete the row |
| W4 | Branch Manager raised ₹3,00,000 → ₹10,00,000 (TEMPORARY) | Restore `limit_paise = 30000000` |
| W5 | Stray `disburse` permissions on HO Accounts / Valuer | Delete those rows |
| **W6** | **Single-person scheme publishing** *(28 Jul, migration 010)* — the maker≠checker CHECK on `scheme_version` relaxed to maker-only until the approval strip is built | Restore SQL is written inside `db/migrations/010_scheme_single_publish.sql`; existing single-signed versions must be given a checker first |

Find the limit rows with: `SELECT * FROM sanction_limit WHERE reason ILIKE '%TEMPORARY%';`

---

## 11 · Where the build stands (28 July 2026)

**Done and live at https://slf.slunawat.in**
Everything from 27 Jul, plus — **vault-in** (recheck · seal · 50×75mm tag · safe entry · mismatch
freeze) · **repayment** (engine wired to the counter; dues + receipt endpoints; appropriation;
₹2,00,000 cash cap across a customer's loans; UTR for non-cash) · **gold release** (SLA list with
working-day banding · borrower-only handover with three gates · vault out-movement · NOC number ·
Marathi WhatsApp copy text) · **masters** (charges · branches with auto number-series · schemes
with five-step wizard, versioning, supersession and branch allocation) · migrations **008–011** ·
test suites: **55 engine · 46 bridge · 32 vault · 31 release · 30 masters**, all run at deploy.

**The counter loop is closed and proven:** pledge → disburse → vault-in → repay → release,
including NOC issue and the custody chain in `vault_movement`.

**Next**
Add-charge screen (extracted, small) · receipt print · day begin/end (needs the O12 cap verdict) ·
cash transfer (needs O2) · then the pending owner verdicts above.

*Read alongside: the frozen `.dc.html` UX (pixel truth) · `db/schema.sql` (data truth) ·
`scripts/test-engine.mjs` (money truth) · `CLAUDE.md` (working rules on the server).*

---

## R-L — both end days count (owner, 28 Aug 2026)

The disbursement day AND the payment day are both interest days; day 1 is the
disbursement day. To keep every day charged exactly once, all anchors now hold
the FIRST CHARGEABLE day of their period: disbursement for the first cycle,
the day AFTER the sealing payment for every later one. Loan age, tenure and
penal days count the same way; `graceTill` names the true last forgiven day.
Engine 1.0.0 → 1.1.0. Golden tests recomputed by hand (26 assertions).

Same session, also owner-ordered: post-receipt success screen gains
"Back to customer" and "Go to home"; Pune calculation test-bed —
`scripts/seed-pune-tests.mjs` seeds 18 back-dated boundary loans on branch 11
relative to CURRENT_DATE (publishes test scheme PPT2490, penal 3%/grace 7,
because all Pune schemes carry penal 0), and `scripts/verify-pune-tests.mjs`
prints the expected-figures sheet the browser must match. TEST DATA — the
seeded rows and PPT2490 are on the pre-onboarding delete list.

---

## E14 — owner punch list of 28 Aug 2026 (ten items)

№1 charge_calc labels: code said "fixed/percent", the database has always said
flat | pct_of_sanction | at_actuals — the mismatch crashed the Charges tab AND
silently made every master charge "manual" on the add-charge screen. All four
files now speak the database's dictionary; "at actuals" is a proper option.
№2 branch code: 2–3 alphanumeric (D-C amended). №4 shared SavedToast on every
form (8 settings tabs, rate board, customer edit → 360 chip). №5 view/edit
customer links on Loan Profile + collect screen; ✎ Edit on the 360.
№6 cheque/passbook upload per bank account (cheque_file_id already existed);
verification records 'cheque_photo' when proof attached. №7 ONE role per
employee — UI single-pick, API refusal, migration 024 unique index.
№8 Day-Begin → Home. №9 Day-End → sign out. №10 borrower + co-borrower live
photos on the Loan Profile parties strip (photos were stored; never queried).
№11 disburse desk: approved file is read-only (pills locked, summary card,
server PATCH already refused) with "Send back for changes" — compulsory note,
approved→appraised, note in state history. NOTE: the frozen HTML contains no
disburse step at all; this screen is beyond-frozen by necessity, styled to the
wizard's language. Send-back skips the wizard's save-first step by design.

---

## E15 — owner punch list of 29 Aug 2026 (nine items; №10 never arrived)

Bugs: №4 verify crashed on a missing ::verify_method cast (introduced E14,
caught by reproduction against the dump); proof photo now lives ON the account
row — add/see/zoom/replace, plus a "proof" API action. №3 branch edits could
never save because legacy landlines (0253-…) failed the mobile-only phone
rule — phones now accept STD landlines (leading 0, 10-11 digits).

№5/№6 (D-E, owner): approval is the cutoff. Draft/appraised = editable by
appraise-rights; approved onward = read-only exhibit for EVERYONE (steps 1-2
render inside disabled fieldsets, tabs stay clickable), send-back the only way
back. Send-back note now shows as an amber banner in the wizard AND a
"Sent back — needs correction" queue on Home; disburse-only people may open
the file read-only. №1/№2 (D-F, owner override of the frozen narrow editcust):
NewCustomerClient now serves create / edit / view — the edit screen IS the
new-customer screen, all fields prefilled, Aadhaar masked to last-4 (retyping
runs creation's duplicate ceremonies), cust_no immutable, banks managed on the
360, documents add-only. View rights get the identical untypeable screen.

№7 (owner override of Claude's recommendation): day-end — manual AND automatic
— cancels EVERY undisbursed application of the branch, including pending_ho.
№8/№9: scripts/auto-daycycle.mjs + systemd timers — auto day-end 23:59 IST
(counted=expected, no denominations), auto day-begin 11:00 IST (carry copied),
all stamped automatic under employee 1.

Build lessons repeated the hard way: a scripted signature splice left two
props OUTSIDE the destructuring (silent wrong defaults), and a read-only flag
computed above the state it reads crashed every pledge SSR while the first
walk pass showed a vacuous green. Both caught by walking twice. Walk twice.

Data finding for the owner: scheme sv7 (GL2070 v2) has effective window
27-Aug-2026 → 27-Aug-2026 — one day, now past; new pledges cannot select it.

---

## E16 — owner walk findings of 29 Aug 2026 (ten items; №11 blank again)

№6: branch code failed on the DATABASE constraint branch_code_2char — E14
moved the form and masters.js but not the third layer. Migration 025 replaces
it with {2,3}. "Enforce twice" means every layer moves together; relearned.
№4/№5: Aadhaar is stored last-4 ONLY — the box now carries "on file ••••NNNN —
type full number to replace" as its placeholder; the current photo renders as
a thumbnail beside the upload box (the box previews only fresh uploads).
№3/№7: bankPayable reads verifyMethod+verifiedAt — the E15 mapping dropped
both, so "cheque ✓" and "still needed" showed together. Mapping fixed; the
cheque path is now ALWAYS open unless penny-verified (attach/see/replace),
edit-screen bank rows actually SAVE (update by id, insert new; deletion stays
on the 360), and compact PhotoInput finally prints its label — a bare 📷 was
the real reason nobody could find the upload.
№1: 360 shows 👁 View AND ✎ Edit; ?view=1 forces the read-only life.
№2: 360 gains "Applications in progress — not yet disbursed" so an approved
file can never hide again. №8: ornament photos on the step-3 review card
(pledge page now signs photo URLs — step 1 previews them too).
№9: an approved file opens at tab 1 — review front-to-back, end at Disburse.

№10 — D-E AMENDED (owner, 29 Aug 2026): DISBURSAL is the cutoff, not
approval. The creator may edit an approved file; the save automatically
returns it to appraised with a state-history note and a loud chip — fresh
approval required, so the checker never pays out silent changes. Proven in
the walk: creator save → deapproved:true → status appraised → note recorded.

---

## E17 — owner walk findings of 29 Aug 2026, second round (seven items)

№2 (the build): migration 026 — receipt.slf_bank_account_id. UPI/bank
repayments must name the SLF account that received the money: compulsory
dropdown on the collect screen (branch-scoped, allow_collection — the flag
the schema had ready), API refuses non-cash without it, ledger prints
"UPI → <account>". Cash carries NULL; day-end cash math untouched. CHECK
constraint NOT VALID so historic test receipts stand; every new row obeys.
№1: the 360's in-progress card is branch-aware — links only within the
acting branch, otherwise "at <code> — switch branch to open" (the 404 was a
cross-branch file meeting the pledge screen's correct branch scoping).
№3: rupeesInWords (Indian lakh/crore) in format.js; the collect screen reads
the amount back — "₹20,000 — rupees twenty thousand only".
№4/№5: ← Back to customer atop the customer screen; Cancel in its footer.
№6: previously uploaded document scans render as clickable thumbnails per
row (signed server-side); new scans may join an EXISTING document.
№7: a verified bank row now shows its cheque thumbnail and a replace button
(the verified branch of the cell hid the proof entirely).
Walk lesson: never inline $$ in a shell-quoted probe — write walks as files.

---

## E18 — day-number displays (owner catch, 29 Aug 2026)

The engine billed R-L inclusive days, but three DISPLAYS still showed the SQL
gap (one less): the Loan Profile header, the Customer 360 loan card, and the
collect screen header (which also mislabelled the current CYCLE length as the
loan's day on paid loans). All now show the same truth: day 1 = disbursement
day, (CURRENT_DATE − disbursed_at) + 1; the dues API carries ageDays so the
collect header names the loan's age while the working line names the cycle.
The release SLA counter was already inclusive (closure day = day 1).
Walked on A4: profile, collect and 360 all read day 101, working Day 1–60,
receipt bought 41 → 41+60=101. A1 reads day 9 everywhere.

---

## E19 — owner refinements (29 Aug 2026)

№1: the wizard carries "← Back to customer" — leave an undisbursed file
without touching it; the application stays alive exactly as it was.
№2: the 360's bank rows are decluttered to tag (verified/unverified) +
View + Edit. The proof photo, add/replace, and Mark-verified ceremony all
moved into the new View panel (and the Edit form shows the current proof
thumbnail beside its upload). E15's row-level camera is retired — the row
states facts; the panels do work.

---

## E20 — owner batch of 29 Aug 2026 (confirmed scope, then built)

Flags decided for the owner (accepted with "go"): typed date box WITH a 📅
calendar shortcut; camera permission remembered by the browser's own site
grant; photo delete is SOFT (leaves screens, survives in audit).

№1 dates: dmy() in format.js is the one display (DD-MM-YYYY); every raw ISO
print swept (home queues, 360 card, sent-back banner). Entry: DateInput —
digits self-hyphenate to DD-MM-YYYY, 2-2-4 enforced, impossible dates (31-02)
refused with a red chip, values stay ISO inside the app. Swapped at customer
DOB, follow-ups (360 + overdue), employee DOB/DOJ/DOL, scheme windows.
№2 camera: PhotoInput gained a real Camera option (getUserMedia, back camera
preferred, live preview, snap → same compress+upload path). Compact = 📸
beside the file button; full = "📸 Camera" beside "choose file".
№3: Ready-to-disburse rows created by me carry ✎ Edit (wizard; D-E amended
de-approves on save). Others' rows unchanged.
№4: migration 027 customer_bank_proof — an account keeps a proof HISTORY.
Existing single cheques migrated in; cheque_file_id remains the "current"
pointer bankPayable reads, following the newest live photo. View panel =
pure read gallery; Edit form = gallery with per-photo soft delete, add, and
the Mark-verified ceremony. Proven live: add → 1 live row; remove →
removed_at + removed_by stamped, screens clear, audit keeps the record.

---

## E21 — owner batch of 29 Aug 2026, second confirmed round

№2 — OWNER OVERRIDE, recorded with Claude's warning attached: full Aadhaar
stored in PLAIN TEXT (customer.aadhaar_no) and displayed fully. Claude flagged
UIDAI Data-Vault/masking rules; owner ruled storage-in-clear. Migration 028:
unique on aadhaar_no, mobile, upper(pan_no). Mobile NEVER repeats — even
husband-wife — it becomes the app login (owner, explicit). Employee-customer
overlap stays legal (cross-table checks remain confirmations). Same-table
duplicates are HARD refusals with the owning customer named; dupAcknowledged
cannot override them (proven in walk). Legacy rows carry last-4 only until
retyped; the header says "full number not yet captured".
№1 — post-snap editor in PhotoInput: rotate (baked into pixels so the crop
rectangle is always true), drag-to-crop, reset, use; output flows through the
same 1600px/0.72 + 320px-thumb compression as every upload.
№4 — compression VERIFIED: /api/files is the single upload path and only
PhotoInput calls it; every photo is compressed client-side before upload.
№3/№4(loans) — party photos: the wizard now RESTORES saved presence and
co-borrower photos (they initialised to null — reopening forgot them) and the
API keeps absent fields instead of nulling them (a partial save used to ERASE
the saved photo ids — proven, then proven fixed: presence 99 survives).
Step-2 shows the saved photos; the step-3 review card shows both faces.
