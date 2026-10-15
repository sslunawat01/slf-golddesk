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

---

## E21b — the deploy episode's debts (29 Aug 2026)

The E21 deploy cost the owner three rounds of ten silent minutes. Post-mortem:
1. migrate.mjs deadlocked on ANY failure — the catch awaited pool.end() while
   the failed client was still checked out; release() sat in a finally that
   never ran. Fixed: release before end; failure now prints and exits 1 in
   under a second (proven with a deliberate failing migration).
2. The failure itself: production had duplicate mobiles among customers made
   AFTER Claude's data snapshot, plus TWO customers sharing an empty-string
   PAN — creation stored '' instead of NULL for blank PANs. Code fixed
   (pan || null); production and local blanks cleaned to NULL.
3. TWO NEW STANDING DEPLOY RULES:
   a) any migration that creates an index on a hot table ships a STOP-SERVICE
      deploy block, stated in advance (index creation waits on app locks);
   b) pre-deploy data checks for constrained migrations run against a FRESH
      production dump requested at deploy time — never yesterday's copy.
Owner ledger: Chaitali Kotecha (id 36) carries placeholder mobile 9000000036
until edited; Zztest Anil Deshmukh owns 9000000001 (delete list).

---

## E22 — create-customer 500 (owner report, 30 Aug 2026)

"Server error while saving customer": EVERY new-customer save crashed —
E21's same-table duplicate block referenced an undeclared `mobile`
(ReferenceError → raw 500 before the transaction; nothing was written).
Reproduced against the 29 Aug production dump, one-line declaration added.
Same walk exposed the sibling defect: the mobile/Aadhaar hard checks sat
INSIDE the dupAcknowledged gate, so a confirmed cross-table duplicate
skipped them (the DB unique index still refused — two-layer held — but with
the generic message). Moved outside the gate: dupAcknowledged can never
override a same-table duplicate, matching E21 №2 as recorded. Walked twice
with fresh values (scripts/walk-customer-create.mjs): clean create 200;
dup mobile / dup Aadhaar / dup+ack all 409 naming the owning customer.
Battery 19/19 green. Lesson: E21's dup-refusal walk exercised the EDIT
path only — every NEW code path gets its own walk case, including the
plain no-duplicate submit.

---

## E23 — the first automatic day cycle never ran (journals, 30 Aug 2026)

Both timers fired to the second (23:59:33 / 11:00:33) and both services died
at launch: the unit files hardcoded /usr/bin/node, which does not exist on
the server (node lives under nvm; the main service uses /usr/local/bin/node).
Units fixed to /usr/local/bin/node — the path systemd demonstrably runs.

The post-mortem found a second, worse latent bug: auto-daycycle.mjs opened a
raw pg pool with NO entity context, and receipt / loan / loan_application sit
behind the entity RLS wall — every flow sum and the №7 cancel query would
read ZERO rows for an RLS-bound user (day closed at opening cash, nothing
cancelled, all silent). Both scripts now take one client and set
app.entity_ids='ALL' session-wide. Proven locally against the 29 Aug dump:
before the fix B1's 28-Aug catch-up closed at ₹1,84,500 (opening); after,
₹1,78,900 (opening + ₹6,400 cash in − ₹12,000 cash out) — the hand figure.

State repair: 28 Aug days for B1 / Head Office / Chinchwad were left open
(29/30 Aug had no day rows at all — nobody signed begin, and auto-begin's
first fire was the failed one). One-time scripts/catchup-dayend-20260828.mjs
closes exactly those three at opening + that day's own flows, stamped
employee 1, audit action day_end_catchup; refuses a second run. It
deliberately does NOT cancel applications — tonight's fixed auto-end applies
№7 in course, leaving the owner the afternoon to disburse keepers.

Data finding: 7 applications (3 draft, 4 appraised) sit ON the Head Office
branch (999) — day cycles never run for HO, so №7 can never reach them;
they are walk debris (incl. Sangita's APP-999-26-0002) → delete list.

Lessons: an ExecStart path is a fact to verify on the target machine, not a
convention to assume; and any script that bypasses lib/db.js must set the
entity wall itself — the wall fails CLOSED, and closed looks exactly like
"no data" (the vacuous-green class again, now in SQL form).

**E21 owner browser walk — confirmed 30 Aug 2026:** full Aadhaar displayed,
camera rotate/crop working, party photos survive reopen. (Duplicate refusal
was separately proven and hardened under E22 the same day.)

---

## E24 — owner ledger rulings of 30 Aug 2026

№1 both blank №11s: DEAD — struck. №5 O13 RESOLVED: R-I stands, the penal
grace cliff is accepted (day 372 pays ₹0, day 373 pays from tenure end).
№6 O5 RESOLVED: release print on A4, Marathi (regional) font required —
print-layout build to honour both. №7 SMS provider stays pending. №8 the
three SLF bank accounts remain dummy data by owner's word. №10 Chaitali's
real mobile entered by owner. №4/№9/№11 shipped as
scripts/datafix-20260830.mjs (idempotent, prints everything it touches):
deactivate any safe labelled/located "Deolali" (none in the 29 Aug dump —
the script reports what it finds on production); GL2070 v3/v4/v5 carried
effective_to 27 Aug BEFORE effective_from 28 Aug — end set equal to start
(v6 is the live open-ended version; the E15 "expired scheme" flag was
stale data, superseded versions were made for tests); the HO-branch walk
applications (APP-999-26-0002…0008) cancelled with history notes — day
cycles never run for HO so №7 could never reach them.

---

## E25 — messages at the top of the screen (owner order, 30 Aug 2026; D-G)

Every refusal and suggestion now ALSO appears in a fixed banner at the top
of the screen (src/app/ui/TopNotice.js: red for errors, amber for warnings,
✕ to dismiss, holds until dismissed or replaced) — no more scrolling to find
out why a save refused. Wired into 22 screens: both wizards (save, submit,
tab moves), collect, add-charge, day begin/end, vault list + vault-in,
release list + release, overdue, bank panels, follow-ups, set-password,
new-pledge button, all eight settings tabs, and the rate board. Field-level
chips stay where they are — the banner says THAT something refused, the chip
says WHERE; successes stay with the green SavedToast. PhotoInput's upload
errors stay at the widget (it mounts many times per screen — a fixed banner
per instance would stack). The frozen UX has no such banner — recorded as
owner override D-G. Walked twice headless (scripts/walk-topnotice.mjs):
banner appears once, carries the refusal text, y=64, survives scrolling,
dismisses; every touched screen re-opened. Battery 19/19.

Local-sandbox note: the local app role now carries BYPASSRLS to mirror
production (the app's own one/q set no entity context; production's user
owns the tables). Scripts that must work under EITHER user keep setting
app.entity_ids='ALL' explicitly (E23).

---

## E26 — every metal its own rates (owner GO, 30 Aug 2026; O7 RESOLVED, V8 amended)

A1: on the rate board, typing a market rate fills funding at 10% below,
floored to ₹100 (conservative — Claude's default, flagged); a hand-typed
funding figure stops the auto-fill for the visit. A2: migration 029 adds
application_rate — an application snapshots the in-force pair of EVERY
unlinked enabled metal at creation (gold backfilled for all 75 existing
apps; the legacy gold columns stay written for compatibility). The wizard
and the items PATCH price each ornament off ITS metal's snapshotted pair;
a metal with no pair in force when the pledge started refuses to price on
BOTH layers (client chip + API 409) — never borrows the gold rate. Silver
purities corrected to 99/80 (% of silver's own rate; legacy rows were
1.75/1.25% OF GOLD — datafix №3; zero silver items existed, and every item
snapshots its pct and rupee figures anyway). Walked twice end-to-end:
silver pair published → application 76 snapshots both pairs → 100g
Silver99 prices ₹11,88,000 and 10g 22K ₹1,13,200 (hand figures) → UI shows
both, auto-fill 9050→8100 proven, hand-typed funding survives. Battery
19/19. NOTE: production has no silver rate row yet — the owner publishes
silver's first pair on the board after deploy; until then silver still
politely refuses (correct).

---

## E27 — the Reports section (owner order + GO, 8 Sep 2026)

Seven reports under /reports, grouped as the owner named them (MIS ·
Transaction · Cash/Bank/Financial): Branch Loan Summary, Loan Repay
Register, Loan Application History, Outstanding Amount Report, Loan
Details dossier, DayBook, Ledger Report. Beyond-frozen by necessity (the
frozen UX names the section but designed no screens); styled to the app's
language, "Reports" added to the header for reports-permission holders.

Access, enforced in src/lib/reports.js so no route can forget: the
`reports` permission gates every screen AND API; the branch wall shows a
user ONLY branches they are posted to — "All my branches" means THEIR
branches; an API asked for a foreign branch answers 403 naming the wall,
and the Loan Details dossier refuses loans of foreign branches by name.

Filters: FY (Indian, list derived from the first loan on record) on every
report, plus from/to within FY, branch, and per-report extras (scheme /
overdue-only; state + text search; mode / SLF account / settlements-only;
account head). Every register: totals row, CSV download (rupees, not
paise), print that emits ONLY the report region.

Figures doctrine: Outstanding, Branch Summary and the dossier price live
loans through the SAME engine replay the collect screen uses; the Repay
Register prints the STORED appropriation rows, never recomputed. Ledger
v1 is DERIVED, CASH-BASIS (owner silent on a/b — Claude ruled (a),
recorded as owner-accepted): entries computed from receipts (Cr split per
appropriation, charge GST pro-rata from its loan_charge), disbursement
legs and cash transfers; opening balances zero; real double-entry posting
stays on the roadmap before an accountant relies on it.

Walked twice at BOTH layers (scripts/walk-reports.mjs, -ui.mjs), 22 API
assertions cross-checking against the dues API, raw SQL sums and the
signed day-cycle: engine figures match to the paisa; every repay split
sums to its receipt; DayBook 28 Aug B1 opens ₹1,84,500 and closes at the
signed ₹1,78,900; the derived ledger balances ΣDr = ΣCr exactly. Battery
19/19.

**E27a (owner, 9 Sep 2026):** Branch Loan Summary gains two columns —
"O/s Loans From" and "O/s Loans To": the oldest and newest disbursement
dates among the branch's active loans (blank when a branch holds none).
Verified against SQL min/max per branch, twice.

---

## E28 — "cannot select a role" + full code audit (owner report, 14 Oct 2026)

**The reported bug.** EmployeesTab step 3 called the CURRIED helper
`setW(obj)` — it builds a setter and throws it away, so a role click did
nothing and Next never unlocked. Introduced by E14 №7 (28 Aug, single-pick
role); the last employee anyone could create was on 27 Aug. One-line fix
(setWiz). Walked end to end in a browser: role ticks, wizard completes,
employee lands in the DB with exactly one role and the right branch, and
signs in (scripts/walk-employee-create.mjs).

**Audit.** Four independent reviewers (client state, API auth/branch walls,
money units, schema-vs-code), every claim re-verified by Claude before any
change. Fixed in this patch — all unambiguous bugs, no policy change:

1. CRITICAL — /api/auth/branch minted a session for ANY employeeId in the
   body: no password, no cookie. Proven locally: `{employeeId:1,branchId:1}`
   returned an owner session that read the staff list. Now: the header
   switch uses the live session (body id ignored, old session revoked); the
   login picker needs a 5-minute HMAC ticket that /api/auth/login issues only
   after the password check (src/lib/loginticket.js, key derived from
   DATABASE_URL, fails closed). New suite scripts/test-loginticket.mjs (21).
2. CRITICAL — W7 CLOSED. Forgot-password returned the reset code to the
   browser for ANY username. The owner's recorded condition ("only while the
   owner is the sole user") had passed — 11 staff accounts exist. The code is
   never returned now; self-service refuses up front (no username probing)
   until SMS is genuinely wired (SMS_WIRED flag). Administrators reset via
   Settings → Employees; the owner's own recovery is
   `node scripts/set-password.mjs slunawat` on the server.
3. HIGH — the full customer edit changed a verified bank account's number
   while KEEPING verified_at; the payout trigger checks only verified_at, so
   payouts could be redirected, unaudited. Now clears verification exactly
   like the bank-only route and audits before/after numbers.
4. HIGH — Cancel had no permission check; now appraise=full (the only people
   the wizard ever offered it to). Cancelling an HO-pending file 500'd
   (ho_approval_check decided_by ≠ recommended_by) — now a withdrawal.
5. HIGH — HO could approve a CANCELLED file back to approved (rows 2-4 were
   live). Approvals now guarded (status='waiting' AND app 'pending_ho', row
   counts checked → 409); both day-end paths close HO rows when cancelling;
   scripts/datafix-20261014.mjs withdraws the stale rows (idempotent).
   Missing decision → 400, not a 500.
6. E27b REBUILT (the Sep tarball was lost with the workspace and never
   deployed): reports' state.principal ×100 (100× principal / total due)
   fixed; Branch Summary "O/s at Period Start/End ₹" by engine replay as of
   each date; the misread date columns removed.
7. Customer 360 replayed charges with no date (sorted after all receipts) —
   10 of 44 live loans showed wrong principal/charges. Release SLA read
   holiday.day (column is on_date; error swallowed) — holidays never skipped.
   Add-charge label compared to 'percent' (enum says pct_of_sanction).
8. Screens: cheque photo sent as an object (lost); "Close loan" flag stuck
   after typing a smaller amount (part payment priced as a closure); Charges
   tab vanished on any refusal; unticking the starred branch left a dangling
   primary (refused at the last step).

Walked twice at both layers (scripts/walk-e28.mjs — 28 assertions against
the DATABASE; scripts/walk-e28-ui.mjs — picker login, header switch, collect
labels, forgot page), plus every earlier walk. Battery 20/20.

**OPEN — verified findings NOT fixed here (need an owner ruling or their
own build).** Ranked by risk:
- O-A Rate correction same day → raw 500 (`DELETE FROM daily_rate` hits the
  append-only trigger). Needs a migration; and the rate is single-signed
  (maker = checker) though the constitution says maker ≠ checker.
- O-B Receipts take no row lock: a double-click can post two receipts /
  two closures; UTR not unique. Needs SELECT … FOR UPDATE + a unique index.
- O-C Search shows loans of ALL branches to anyone signed in. Ruling: should
  search be branch-walled like reports?
- O-D Self-escalation: set_employees:edit can grant itself any role/branch;
  set_roles:edit can raise its own sanction limit. Ruling: who may grant?
- O-E Admin password reset sets force_change=FALSE (owner decision 12 Aug)
  — the admin keeps knowing the password. Recommend TRUE.
- O-F Engine 1.1.0 re-prices receipts written under 1.0.0 on replay (loan 1:
  receipt says principal ₹99,230, replay ₹99,280; overdue list disagrees
  with collect). Needs a ruling: replay stored splits for old receipts?
- O-G Cash cap allows exactly ₹2,00,000 (`>`); Sec 269ST bars "₹2 lakh or
  more". CLAUDE.md says "≤". Ruling.
- O-H Scheme not validated server-side on the pledge (any version id, any
  branch allocation); valuers / SLF account ids unchecked; pledge PATCH
  writes no audit.
- O-I Edit-customer screen blocks saves for pre-E21 customers (runs the
  create-time validator; existing scans not counted); Aadhaar/PAN scans
  added in edit mode are dropped.
- O-J Custody: release allowed from at_counter with no vault movement
  (01A6702306); frozen packets have no HO clear action (PKT-01-25-0003);
  B3 Nashik has no safe but holds approved APP-03-26-0001.
- O-K 10 non-cash receipts (RCPT-01-26-00842…00854) have no SLF account —
  the NOT VALID constraint can never be validated until backfilled.
- O-L Smaller: overdue loanDay off by one vs R-L; loan-profile monthly
  estimate divides by loan age; principal "outstanding" on the 360/search is
  the sanctioned amount; employee wizard demands a branch though the owner
  ruled posting optional; HO branch can open day cycles; pledge wizard can
  freeze on a non-JSON error; search can show a stale query's results;
  photo upload can overwrite fields typed meanwhile; app-history filter
  offers states never written; seed loans carry 100× weights (delete list).

---

## E29 — payouts to UNVERIFIED bank accounts (owner ruling, 14 Oct 2026)

**OWNER OVERRIDE of R19 / C10, recorded with Claude's warning.** R19 refused
any payout to an account without verified_at. Verification is the only guard
between a mistyped or swapped account number and money sent to a stranger —
a wrong bank transfer is usually unrecoverable — and E28's bank-swap fix
relied on it. The owner ruled: allow it, behind a pop-up.

What was built (rule kept in BOTH layers, reshaped from "refuse" to
"refuse unless signed"):
- Migration 030: disbursement_leg.unverified_ack_by; trigger
  fn_leg_requires_verified_bank now refuses an unverified leg with no
  confirmer, and refuses a confirmer who CREATED the loan file (owner, same
  ruling: "anyone with permission but not the user who created the loan").
- Disburse API: an unverified leg needs body.unverifiedAck; without it,
  409 with everything the pop-up shows — the account IN FULL (number, IFSC,
  holder, amount) and any number change in the last 30 days (who, when, the
  old last-4; 30 days is Claude's default). Audit names the unverified
  accounts and the confirmer. The creator still never disburses (E17b).
- Wizard: unverified accounts selectable (amber tag); Pay → pop-up.
  E29b (owner, same day): the pop-up offers, per account, VERIFY BY DOCUMENT
  (cheque/passbook photo → the same proof + verify actions as the 360,
  audited the same; needs edit-customer rights, as the 360 does) or VERIFY
  BY BANK API — shown but switched off: no penny-drop provider is connected
  (O11). When every flagged account is verified the button becomes "All
  accounts verified — pay now" and nobody signs for risk; otherwise "Pay
  without verifying — I have checked the account" signs it.
- ONE meaning of "verified" everywhere, the database's: verified_at is set.
  The screens used to treat a cheque photo alone as payable while the
  trigger refused it — cheque-only payouts crashed at the last step.
- New customers may be SAVED with unverified accounts (owner); the creation
  validator no longer demands verify/cheque (IFSC and holder still checked).
- Loan Details marks each payout "unverified — confirmed by <name>".

Proven: scripts/walk-e29.mjs (API + DATABASE: verified pays straight;
unverified → 409 and nothing written; confirmed → signed leg + audit;
dossier; the trigger alone refuses no-confirmer and creator-confirmer; the
creator cannot disburse; new customer saves with an unverified account) and
scripts/walk-e29-ui.mjs (browser: pop-up shows the account in full and the
recent-change warning; Go back pays nothing; Pay without verifying signs it;
verify-by-document verifies in the DB, joins the proof gallery, then pays as
verified). Both twice; all earlier walks re-run; battery 20/20 (old-rule
assertions in test-valuation / test-customer rewritten as new-rule ones).

Ledger: O11 penny-drop provider now also lights up "Verify by bank API".

## E30 — Maraekat test-data import, B3 Nashik (owner, 15 Oct 2026)

Owner: "upload this data… fill what you do not find judicially… testing
data". Rulings: ANONYMISE names and mobiles · FULL REPLAY through the engine ·
schemes INFERRED from the data where he has none · ReEntry = RENEWAL.
Mid-build he created IND04, IND12, VIN12, GL2070 v7, GL2080 v3 for B3 —
those win over anything inferred.

Pieces (all in scripts/, none touch src/):
- lib-maraekat.mjs — the pure planner; test-maraekat.mjs (51 tests).
- import-maraekat.mjs <json> [--commit] — one transaction; without --commit
  it is a full rehearsal that rolls back. Self-check before commit: every
  imported loan is re-read from the database and replayed through
  loanstate.replayLoan; any difference from the plan → rollback.
- purge-maraekat-import.mjs [--commit] — removes every test customer and all
  that hangs off them (incl. anything staff added later), the MRK- schemes,
  Safe M, the MRK SLF accounts, the placeholder photo rows. Lifts the
  append-only guards inside its own transaction only; checks they are back.
  Audit rows stay; the two import employees are renamed, not deleted.
- walk-maraekat.mjs (API) and walk-maraekat-ui.mjs (browser).
- import-data/maraekat-b3.json — anonymised (invented names, 60000xxxxx
  mobiles; staff e-mails and party names dropped). Not committed to git.

How each gap was filled ("judicially"):
- Scheme: the owner's published version of the same code, offered at B3 and
  in force on the loan date (highest version if several); else MRK-<code>
  inferred: Maraekat divides by a 360-day year (its 18% shows as 18.3% over
  365 at every age); slab edges from median implied rates by loan age.
  Inferred schemes are inactive and offered at no branch.
- Principal → ₹100 steps (R-J), largest payout leg absorbs it (1 loan).
- Receipts: closing receipt = GoldDesk's exact closing settlement that day
  (difference reported); several closing-day receipts keep all but the last
  as paid; under ₹100 → carried into the loan's next receipt; not in ₹10
  steps → rounded down, remainder carried; leftover carry reported dropped.
  Paymode CASH→cash, *UPI→upi, else bank; UTR "MRK-<receipt no>".
- Maraekat "Conso. Charges" → a Misc charge raised that day (settled first, R-G).
- Ornaments: one item per loan, 22K, weight back-computed from the larger of
  eligible and loan amount at an approximate monthly 24K rate (Oct 2024 →
  Sep 2025 market levels, then GoldDesk's own ₹12,300).
- Customers keep their Maraekat number unless it is taken (5 renumbered);
  customer_no_seq bumped past the highest; KYC date = first loan; address,
  nominee, bank accounts are plain "not imported" placeholders (bank ones
  marked verified-manual so historic payouts satisfy the E29 trigger).
- Staff: two INACTIVE, non-login employees (maker; checker approves) — the
  maker ≠ checker trigger holds for every imported loan.
- Custody: new "Safe M — Maraekat import" at B3; running loans in_safe;
  closed ones released (placeholder handover photo); renewed ones out.
- ReEntry: closing through "ReEntry Bank" → closed_by_renewal; renewal row
  1:1 with a new loan of the same customer and day funded by ReEntry
  (closest amounts first — the table is 1:1, Maraekat is many-to-many, the
  rest are reported). ReEntry in/out runs through "MRK · ReEntry adjustment".
- Refuses to run until the day after the export's last date (no imported
  cash in an open day); refuses a second run until purged. Owner, 15 Oct:
  import TODAY — the 3 receipts dated 15 Oct are left out of the json
  (data ends 14 Oct), which is exactly the set rehearsed locally.

Local result (14 Oct prod dump + owner's 15 Oct schemes): 576 customers ·
4,773 loans (1,074 running, 3,104 released, 595 renewed) · 145 cancelled
applications · 8,648 receipts · 499 renewal links · self-check identical ·
walk-maraekat + walk-maraekat-ui twice · purge restored every table count ·
re-import identical · battery 21/21 · E28/E29/reports/employee walks green.

Findings for the register:
- O-M Search matches the name as typed in full: "Nitin Jadhav" does not find
  "Nitin Dilip Jadhav". Product behaviour, not the import — ruling wanted.
- O-N Prod GL2070 v6 and GL2080 v2 have effective_to (2000-10-14) BEFORE
  effective_from (2026-08-28): never in force. The import ignores such rows;
  the owner should close them properly.

## E31 — penal clock = interest-unpaid period; old receipts replay under their own engine (owner, 15 Oct 2026)

Owner rulings (after seeing 03A5600457 carry ₹650 penal on the loan-age rule):
1. Penal only when the INTEREST-UNPAID period exceeds tenure + grace. A PART
   payment of interest restarts that period.
2. Once charged, penal counts from day tenure+1 of that period (grace days
   are charged, not skipped) — same counting as before.
3. Do NOT re-import the Maraekat data.

Engine 1.2.0 (R-I amended in the constitution header):
- New state field `interestClock` = first day interest has been unpaid:
  disbursement at open; the day after ANY payment that reaches interest
  (R-G means penal is always cleared before interest, so a payment that
  touches interest has also settled all penal). Kept under every rule.
- dues()/applyPayment() take `penalRule`: "unpaid_interest" (today) or
  "loan_age" (engine ≤ 1.1.x). Penal start = later of (clock + tenure) and
  the penal anchor. dues().penal now also reports rule, clockFrom, unpaidDays.
- Because receipts are facts, a receipt stored under 1.1.x replays under
  "loan_age": loanstate.penalRuleFor(engine_version) tags every payment event;
  every replay caller now SELECTs engine_version (dues route, loan page,
  customer page, loandetails, reports.js ×2, import self-check, verify-pune).
  This closes the open ruling "engine re-pricing of old receipts": NEVER —
  each receipt replays under the engine that priced it; today's position is
  always priced by today's rule.
- Collect screen: the penal row now says "interest unpaid since <date>
  (N days, past tenure + grace)".

Proof:
- test-engine §4b rewritten (day-200 interest payment → day-210 penal ₹0 under
  today's rule, ₹60 under loan_age) + new §4c (part payment restarts the clock;
  grace window; day tenure+1 counting; a payment swallowed by penal does not
  restart; never-paid loans unchanged → canonical ₹0/₹50/₹360 stand). 70/70.
- test-loanstate §9: penalRuleFor; a 1.1.0 penal receipt replays cleanly in a
  mixed-version history. 55/55. Battery 21/21.
- NEW scripts/verify-replay.mjs — replays every loan in the database and
  compares each stored receipt_appropriation split with the engine's; run
  after every engine change. Local DB mirrored production (import re-run
  under engine 1.1.0 first): 4,832 loans · 8,671 receipts (8,654 under
  1.1.0, 12 under 1.0.0, 5 under 1.2.0). Problem list IDENTICAL before and
  after the engine change — the change introduced none.
- Effect on the imported book today: penal due ₹2,270 on 5 running loans
  (all IND04, interest never paid), was ₹34,470 on 94. 03A5600457 → ₹0
  (interest unpaid 259 days < 407).
- walk-maraekat (expected figures now computed by direct replay, not the
  import report) + walk-maraekat-ui ×2; e28, e29, e29-ui, reports, reports-ui,
  silver green. walk-reports-ui now waits for the figures (Branch Summary
  replays 1,000+ loans twice ≈ 3 s).

Pre-existing blemishes the audit surfaced (not caused by E31, all on junk
test loans; a purge + re-import would clear the 03A ones, owner declined):
- 03A4500273, 03A4500316, 03A5600075, 03A5600920, 03A6700814 (all closed):
  Maraekat "Conso. Charges" on the SECOND receipt of a day were raised
  mid-day by the planner, while buildEvents raises a day's charges first —
  stored split says interest, replay says charge (totals and final state
  identical). Planner fixed (charges of a day raised before its first
  receipt) and the import self-check now compares every stored split, so it
  cannot recur.
- 01A6543110, 01A6598812, 01A6702204, 01A6702306, 01L252600002/3: receipts
  stored under engine 1.0.0 (pre R-L day counting) or seeded by SQL; two
  show "closed" with a closing receipt the engine does not accept. Pre-import
  test loans from July/Aug.
- walk-rates-ui's wizard half depends on application 76 having a silver
  item; on the 14 Oct dump it is cancelled and empty (fixture rot since 29
  Aug). Rate-board half passes. Needs a rebuilt fixture — O-P.

Open: O-O — the overdue worklist's "Past tenure" bucket and the Day-N age
chip still go by LOAN AGE. Should "overdue" follow the new penal clock
(interest unpaid > tenure) instead? Ruling wanted.

## E32 — the 15 Oct punch list (owner, 15 Oct 2026)

Rulings taken before building: cash limits MAY exceed the legal figures
("owner decides" — recorded as an override, warned in red on the screen and
in every audit row); blacklisting is its own ROLE PERMISSION; market value is
hidden only in the pledge wizard; the camera problem was seen on phone AND
laptop.

Migrations: 031 (structure) + 032 (seeds — the enum values 031 adds cannot
be referenced in the same transaction).

1. Camera: both modals now render through a portal on <body> (zIndex 10050+),
   the preview is capped at 60vh so "Take photo" is always on screen, the
   dialog scrolls, the compact buttons read "📸 Take photo" / "📁 Choose file"
   (a bare icon was invisible on laptops), and a device without a camera or a
   refused permission falls straight through to the file chooser.
2. Scheme first: the chooser sits at the top of step 1 (data-scheme-first);
   step 2 shows it read-only. The grid and step 2/3 show FUNDING value only;
   market value is still computed and stored (appraisal note, reports, LTV).
3. Weights: gross, stone and net are all typed; whichever was typed last wins
   (WizardClient.weights): gross→net=gross−stone · stone→net · net→stone=
   gross−net (gross known) else gross=net+stone. Floors at 0.000.
4. Remark on the file: loan_application.remark (≤500 chars), typed in step 2,
   shown in step 3, on the loan page (amber box) and in Loan Details.
5. Customer remarks: customer.warning_remark / blacklist_remark (+ who, when).
   is_blacklisted (generated) now also fires on a blacklist remark, so the
   lending block (mayLend → /api/applications refuses), the search chip and
   the 360 banner follow with no further code. RemarkPopup (portal) greets the
   operator on: search results (once per customer per search session — not
   every keystroke), the customer 360, the collect screen, the pledge wizard.
   RemarksClient card on the 360: warning = edit-customer right; blacklist =
   the new `blacklist` permission (032 seeds it to roles with edit_customer
   FULL and to roles with the settings umbrella). Audit actions
   customer_warning_set / customer_blacklisted / customer_unblacklisted.
6. Settings · Limits (new tab, permission set_limits, seeded from 'settings'):
   cash_disburse_below_paise (payout per loan must be BELOW; law ₹20,000
   269SS) and cash_receipt_day_max_paise (per customer per day, AT MOST; law
   ₹2,00,000 269ST). Read by valuation.disbursementPlan (cashCapPaise) via
   the action route and the wizard, by loanstate.cashCapCheck (capPaise) via
   the receipt route, and by the DATABASE: the fixed CHECK on cash legs is
   replaced by trigger fn_leg_cash_cap reading the setting. Messages name the
   law at the legal figure and "Settings · Limits" otherwise. Audit
   limit_changed carries aboveLegal.
7. Loan page: "Loan amount" tile (sanctioned principal) before "Principal
   outstanding".
8/9. Day Book: two new blocks above the movement table — Loans disbursed
   (loan, customer, scheme, loan amount, mode, account, paid out) and
   Payments collected (receipt, loan, customer, mode, account, CHARGES /
   PENAL / INTEREST / PRINCIPAL / total, settles, by) from the stored
   receipt_appropriation split; totals per column. CSV unchanged (movements).
10. Age: customer.ageOn/underAge; the form shows "· age N" beside the date of
   birth and a red chip under 18; validateNewCustomer and the full-edit route
   refuse under-18 (corporate exempt — an incorporation date is not an age);
   the 360 shows the age.
11. Photos: KYC document scans now show as thumbnails (full size on click) on
   the 360; the loan page shows the sealed-packet and gold-handover photos
   beside the ornament photos. Ornament, presence and co-borrower photos were
   already viewable.

Proof: test-customer 82 (age), test-valuation 72 and test-loanstate 60 (caps
as parameters); battery 21/21; verify-replay unchanged (19 pre-existing);
walk-e32 (API+DB: remarks + permission + lending block + search + audit;
limits API/permission/validation/override audit/DB trigger/receipt cap;
remark PATCH; loan page tile + seal photo; Loan Details remark; day book
blocks and split; under-18 refusal; Settings tab; roles API) and walk-e32-ui
(pop-up + Noted; scheme-first; weights; no Valuation; phone-upright camera
dialog with a fake 9:16 stream → Take photo on screen → editor; age chip;
Limits tab) — both twice; every earlier walk re-run green.

Open: O-Q — the Roles tab shows "Blacklist / un-blacklist a customer" and
"Settings · Limits" automatically; the owner should tick them deliberately
(032 seeded sensible defaults). O-R — the wizard's "Processing fee" line and
the Appraisal Note print still show market value by design (ruling: wizard
only).

## E33 — Follow-ups: loan section, dedicated tab, Home card, register (owner GO on the canvas, 15 Oct 2026)

UX was designed and approved on the Claude Design canvas first (8 artboards:
tab, history drawer, log drawer, loan section, phone, home, report) and then
built exactly as approved, with two engineering adjustments noted below.

Model (migration 033, forward-only, backfills `channel` from the old free-text
`method`): collection_call gains fu_type (followup_type: interest · ptp ·
overdue · renewal · notice · kyc · other), channel (followup_channel: call ·
visit · sms · whatsapp · email · ai_call · notice), ptp_amount_paise,
next_type, assigned_to; call_outcome gains will_renew · not_at_home ·
notice_sent. The table stays append-only (fn_forbid_mutation). Nothing
derived is stored: a loan's DUE follow-up is its latest row's next_follow_up
when no later row exists; MISSED = that date < today; a promise is KEPT when
any receipt falls between the day it was taken and the promised day, BROKEN
once the promised day has passed without one, OPEN until then. The "day" of a
row is its IST calendar day computed in SQL ((at AT TIME ZONE
'Asia/Kolkata')::date) — never String(Date).slice(0,10).

Screens (all collect-desk gated: view to see, full to log):
- Loan page: Follow-ups card in the left column above the payment history —
  next-due banner (missed red / today amber), the system's suggestion, the
  timeline (newest first, receipts interleaved, channel chips, kept/broken
  record), "+ Log a follow-up" in place. The old right-column "Follow-ups &
  notices" card is now "More on this loan" (notices, state history); its
  legacy "+ Follow-up" is off.
- /followups tab (nav, with a red badge = due-or-missed count at the acting
  branch): opens on TODAY for the acting branch; When presets Missed · Today ·
  Tomorrow · This week (with counts) or a custom range; Centre select (walled
  to the actor's postings); Assigned to (everyone / me / unassigned / a
  person); type chips; channel; text search. Bands: Missed (carried into any
  range that holds today — never dropped), Today, Suggested by the system,
  Tomorrow, Later; "Done in this range" stays listed. Every row: Call (tel:),
  History, Log →. History and Log open in a side panel (540px, sticky) on a
  wide screen and full-screen below 1180px; the list beside an open panel
  collapses to the 2-column card layout so nothing is clipped. Save & next
  walks down the list; a just-logged row stays in place marked ✓ logged
  until the filters change; responses are sequence-guarded so a slow fetch
  never paints over a newer one. ?focus=<loanId> opens the log panel on
  arrival (the Home card's Log →).
- The one logging form (FollowupLogForm): 1 what · 2 how (tel: and a
  prefilled WhatsApp link; SMS / AI call log only until a provider is wired —
  ledger) · 3 what happened (promise → amount + date, kept/broken by the
  system) · 4 remark + quick phrases · 5 next follow-up (tomorrow / +3 / +7
  / on PTP day / pick / none) with next type and assignee (must be posted to
  the loan's branch — refused otherwise). Posts to /api/followups; audit
  action follow_up. Starts on the due item's type, else the suggested type.
- Home: "Follow-ups due today · N" card (M mine · K missed, first four with
  Log →, link to the tab), hidden when nothing is due.
- Reports · Follow-up Register (/reports/followups, reports desk): period +
  branch + type + channel + staff; KPI tiles (due · missed · unassigned ·
  logged · promises · kept · broken); tabs Due / Done / Promises (paid-by-then
  amount) / By staff (logged, calls, visits, promises, kept, broken, due
  assigned, missed); CSV per tab.
- Legacy /overdue still works and its POST now writes channel + next_type.

Engineering adjustments to the approved UX (reported to the owner):
1. Suggestions are a SHORTLIST, not the book. On the imported B3 book ~800 of
   1,100 running loans qualify (interest unpaid 30+ days is the norm). The
   whole list took 2 s to price and would have buried the day's work. Now:
   cheap SQL proxies rank every candidate (broken promise → past tenure+grace
   with no notice → renewal within 15 days → longest since the last receipt),
   the engine prices only the top 30 (SUGGESTION_LIMIT), the band header
   says "30 of 795 shown, most pressing first". 2 s → ~170 ms.
2. Missed items are carried into any range that includes today (the design
   said "carried forward, never dropped"; the first cut only showed them
   under the Missed preset).

Also fixed on the way: lib/format.dmy() given a Date (a timestamptz from the
database) printed the 60-character JS date string — the Home "Ready to
disburse" block showed "Wed Oct 14 2026 17:40:19 GMT+0530 (India Standard
Time)"; it now prints the IST day.

Proof: test-followups 55 (labels, presets, due/PTP status, suggestions and
the shortlist ranking, validation, grouping); test-format 34; battery 22/22;
verify-replay unchanged (19 pre-existing); walk-followups (API+DB, 70 checks:
permissions, branch wall, assignee check, columns + audit, every filter, due
derivation and clearing, validation, missed + Home card + badge = DB, PTP
kept/broken, register tabs/filters/wall, legacy POST, pages) and
walk-followups-ui (Playwright at 1300 / 1024 / 768: badge + Home card, bands,
chips, header layout vs card layout, presets, custom range, centre select,
History panel beside/full-screen, Log → promise → Save & next → plain save
→ DB rows, nothing carried between rows, suggested type pre-selected, loan
page log in place, register tabs, no horizontal scroll anywhere) — each run
three times; every earlier walk re-run green (walk-rates-ui's wizard half:
the known O-P fixture rot, unchanged).

Open: O-S — SMS / AI-call providers (ledger); until then those channels only
log. O-T — the suggestion limit (30) and the 30-day interest threshold are
constants in lib/followups.js; make them settings if the owner wants to tune
them. O-U — "overdue" everywhere else still means past tenure (O-O stands).

## E34 — the FUNDING rate is the only rate the application uses (owner ruling, 15 Oct 2026)

Ruling: "use only funding rate from hq/rate for all calculation and display
purpose everywhere in the application; market value is only to be used in
auction cases." Formula confirmed with the owner on real figures before the
change: funding value = net g × funding rate (24K) × purity % × scheme
funding %, rounded UP to ₹100 per ornament (R16, unchanged — the owner was
told the ceiling can exceed the exact figure by up to ₹99 per ornament and
did not ask for rounding down). The valuation engine, the wizard, the save and
approval gates already used the funding figure; this episode removed the
market figure from every other screen.

Changed: Settings · Metals reckoner multiplies the funding rate ("Funding
rate ₹/g"; linked metals use gold's funding rate); HQ rate board's per-purity
reckoner quotes the lending rate only (the board still takes BOTH rates and
refuses funding > market — it is the one place market is entered); HQ
approvals shows Funding value only; the Appraisal Note prints funding value
per ornament and in the totals (no "Valuation"); Loan Details carries one
Funding ₹ column (market no longer sent); the login screen quotes the funding
rate. Market value is still COMPUTED and STORED on every appraisal row
(appraisal_item.market_paise) and in daily_rate for the auction module and
for LTV compliance — it is just not displayed. CLAUDE.md product rule updated.

Also closed O-A on the way (a same-day rate correction raised a raw 500
because the publish route DELETEd today's frozen row): migration 034 drops
UNIQUE (rate_date, metal_id) and indexes (metal_id, rate_date DESC,
published_at DESC); a re-publish now APPENDS a correction row;
rate_in_force() already picks the latest publish of the day; the board's
history shows the time of each publish and marks earlier same-day rows
"corrected later that day"; Settings · Metals reads the latest publish.
Needed now because the owner will set a real gold funding rate for the
first time and may well correct it the same day.

Proof: battery 22/22; verify-replay unchanged (19); walk-e34 (API+SSR: pair
check, same-day correction rows + board marker, login figure, approvals,
appraisal note, Loan Details API, metals API, valuation figure, a fresh
pledge snapshots and prices off the funding rate; restores the pair) and
walk-e34-ui (Metals reckoner header + 22K row ₹11,290 → ₹10,386.80, no
market figure; rate-board reckoner; Loan Details columns; approvals) — each
twice; every earlier walk re-run green (walk-rates-ui: the known O-P three,
two of which assert market figures that are now gone by design — O-P stands
as fixture rot to rewrite).

Open: O-V — the gold funding rate on prod has always equalled the market
rate (₹12,300 / ₹12,300): the owner should publish the real pair.

## E35 — change my password (owner report, 15 Oct 2026)

Report: "I'm not able to change password." Finding: /setpw and /api/auth/password
existed and worked, but nothing linked to them — the only route in was the forced
change after a temporary password; the initials badge was a plain span; the admin
reset card even promised a "sign-in menu" that was never built.

Built: the initials badge (top right) is now the PROFILE MENU — "Signed in as"
name · username · emp code, "Change my password" (→ /setpw), "Sign out".
/setpw has two faces: FORCED (temporary password at sign-in: no current
password asked) and VOLUNTARY (from the menu: the CURRENT password is required
and verified server-side, the new one must differ; an unattended signed-in
screen cannot have its password changed by a passer-by). The live rule chips
now carry the real username. Every open session of the user ends on either
change (unchanged); /login?changed=1 says so. Audit: password_set (forced) /
password_changed (voluntary). Settings · Employees → Reset password keeps
letting an admin type any password manually (shown, not hidden — it is read
out); it now shows the same live rule chips so a refusal is never a mystery,
and the "shown once" card points at the profile menu. No database change.

Proof: battery 22/22; walk-e35 (throwaway employee: voluntary refusals —
missing/wrong/same/policy/username — then success, old session dead, old
password dead, new signs in, audit; admin reset + policy + session end; the
forced path end to end; signed-out callers) and walk-e35-ui (1300 and 768:
menu contents and placement, Change my password → wrong current refused on
screen → username rule chip + disabled button → success → login notice → new
password signs in, one live session; forced form has no current field;
Reset-password dialog chips and the "shown once" card) — each twice; every
earlier walk green (O-P three unchanged).

## E36 — interest in DAYS: paid up to / due for, and what a payment buys (owner, 15 Oct 2026)

Ask: after a part payment, show on the loan page and the collect screen how
many days' interest are paid and how many are due; while the amount is being
typed, show how many days that payment buys.

Definition (derived, never stored; engine.interestCoverage / paymentCoverage,
pure, no pricing change — ENGINE_VERSION stays 1.2.0):
- every day before the cycle anchor is paid (sealed cycles are paid in full);
- inside the open cycle, interestPaidInCycle buys whole days at the rate the
  cycle is priced at TODAY (R-B retroactive: crossing day 62 re-prices the
  cycle at 24%, so the same rupees buy fewer days — e.g. ₹400 = 50 days at 18%
  on day 61, 37 days on day 63; prospective schemes count day by day);
- whatever the ₹10-rounded due does not divide into whole days counts as one
  due day, so paid + due always equals the cycle's length;
- the min-interest floor can carry the customer PAST today (advance days);
- "paid up to" = the last paid day (the day before disbursement when nothing
  has been paid); lifetime paid days = disbursement → paid up to.
- a payment preview: the part reaching interest (after charges and penal,
  R-G) buys floor(amount / per-day) days, capped at due−1 unless it clears
  the whole due, in which case paid-up-to becomes today (or the floor date).

Screens: components/InterestClock — one strip, same words everywhere:
"✓ Interest paid up to DD-MM-YYYY (N days) · ● Due for M days — DD-MM to
DD-MM · ₹X" (green when nothing is due or paid in advance, amber ≤30 due
days, red beyond). Loan page: under the figure tiles (running view, active
loans only). Collect screen: under the header; the interest working row says
"of these, N days already paid (up to …) · M days due (… to …)" with the
Days column = due days "of C"; under "To interest" in the appropriation
panel a live line — "₹a pays N days of interest — from to. Still due: M days
(from to) = ₹r" / "less than one day's interest" / "Interest paid in full for
all M days … paid up to today; the clock restarts tomorrow" (or "carries the
customer to … N days ahead" under the floor); the chip repeats the days. The
receipt view and the printed receipt carry "Interest paid up to … (N days)"
and "Interest still due: M days from …". APIs: /dues answers `coverage`;
/receipt answers `coverageAfter`.

Proof: test-engine 89 (§10, 19 cases incl. loan 03A5602283's figures:
₹870 → 82 days, 25 Feb → 17 May; full → paid up to today; floor → 10 days
ahead; retroactive re-pricing; prospective; sub-day amounts); battery 22/22;
verify-replay unchanged (19); walk-e36 (API+DB on a fresh never-paid loan:
nothing paid → part payment: days bought = per-day arithmetic, paid+due =
cycle, anchor unmoved, dues == coverageAfter, stored appropriation matches →
balance interest: paid up to today, seals the cycle → loan page strips →
closed loan has none) and walk-e36-ui (1300 and 768: strip, working row,
live preview for a part amount / ₹100 / Interest-only, chips, real cash
receipt, receipt view + print lines, loan page after, working row split) —
each twice. Earlier walks green; walk-e28/e35/employee-create fail only after
18:00 IST because their throwaway Counter Operators hit that role's sign-in
window — re-run with the window widened: all pass (O-W: give the walks a
role without a window).
