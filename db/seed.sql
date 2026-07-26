-- ============================================================================
-- SLF GoldDesk — SEED v1 (demo canon → dev/UAT fixtures)
-- Deterministic ids via OVERRIDING SYSTEM VALUE; sequences resynced at the end.
-- Business "today" for the canon: 2026-07-25.
-- ============================================================================
BEGIN;

-- —— metals & purities ——
INSERT INTO metal (id, kind, enabled, valued_as_pct_of_gold) OVERRIDING SYSTEM VALUE VALUES
 (1,'gold',TRUE,FALSE),(2,'silver',TRUE,TRUE);
INSERT INTO purity (id, metal_id, karat, purity_pct, effective_from) OVERRIDING SYSTEM VALUE VALUES
 (1,1,'22K',92,'2024-04-01'),(2,1,'21K',87,'2024-04-01'),
 (3,1,'20K',83,'2024-04-01'),(4,1,'18K',74,'2024-04-01'),
 (5,2,'Silver99',1.75,'2024-04-01'),(6,2,'Silver80',1.25,'2024-04-01');

-- —— org ——
INSERT INTO entity (id, series, code, legal_name, fy_start_month) OVERRIDING SYSTEM VALUE VALUES
 (1,'B','SLF','S Lunawat Finance Pvt Ltd',4),
 (2,'V','VBOOK','SLF V-Book',4);
INSERT INTO branch (id, entity_id, code, name, is_ho, address_json, phone) OVERRIDING SYSTEM VALUE VALUES
 (1,1,'01','B1 Bhagur',FALSE,'{"line1":"Main Rd","pincode":"422502"}','0253-000001'),
 (2,1,'02','B2 Nasikroad',FALSE,'{"pincode":"422101"}','0253-000002'),
 (3,1,'03','B3 Nashik',FALSE,'{"pincode":"422001"}','0253-000003'),
 (4,2,'V1','V1 Bhagur',FALSE,'{"pincode":"422502"}',NULL),
 (5,2,'V2','V2 Nasikroad',FALSE,'{"pincode":"422101"}',NULL),
 (6,2,'V3','V3 Nashik',FALSE,'{"pincode":"422001"}',NULL),
 (7,1,'999','Head Office',TRUE,'{"pincode":"422502"}','0253-000999');
INSERT INTO safe (id, branch_id, label) OVERRIDING SYSTEM VALUE VALUES
 (1,1,'Safe A — main vault'),(2,1,'Safe B — overflow');

-- —— employees (password placeholders; force_change on) ——
INSERT INTO employee (id, emp_code, full_name, designation, primary_branch_id, username, password_hash, force_change, status)
OVERRIDING SYSTEM VALUE VALUES
 (1,'E001','S. Lunawat','Owner',7,'slunawat','argon2id$SEED-RESET',TRUE,'active'),
 (2,'E002','D. Karanjkar','HO Accounts',7,'dkaranjkar','argon2id$SEED-RESET',TRUE,'active'),
 (3,'E003','V. Gatir','Valuer',1,'vgatir','argon2id$SEED-RESET',TRUE,'active'),
 (4,'E004','Sarita P.','Counter Operator',1,'saritap','argon2id$SEED-RESET',TRUE,'active'),
 (5,'E005','S. Shinde','Branch Manager',1,'sshinde','argon2id$SEED-RESET',TRUE,'active'),
 (6,'E006','R. Patil','Branch Manager',2,'rpatil','argon2id$SEED-RESET',TRUE,'active');

INSERT INTO role (id, name, is_system) OVERRIDING SYSTEM VALUE VALUES
 (1,'Owner',TRUE),(2,'Branch Manager',FALSE),(3,'Counter Operator',FALSE),
 (4,'Valuer',FALSE),(5,'HO Accounts',FALSE);

-- Owner: full on everything; others: representative bundles
INSERT INTO role_permission (role_id, fn, level)
SELECT 1, f, 'full'::perm_level FROM unnest(enum_range(NULL::perm_function)) AS f;
INSERT INTO role_permission (role_id, fn, level) VALUES
 (2,'appraise','full'),(2,'sanction','full'),(2,'vault','full'),(2,'disburse','full'),
 (2,'collect','full'),(2,'renew','full'),(2,'release','full'),(2,'dayend','full'),
 (2,'cash_transfer','full'),(2,'reports','full'),
 (3,'appraise','full'),(3,'collect','full'),(3,'renew','full'),(3,'release','full'),
 (3,'dayend','full'),(3,'disburse','full'),(3,'vault','full'),(3,'reports','view'),
 (4,'appraise','full'),(4,'reports','view'),
 (5,'reports','full'),(5,'rate_maker','full');

INSERT INTO employee_role (employee_id, role_id) VALUES
 (1,1),(2,5),(3,4),(4,3),(5,2),(6,2);
INSERT INTO employee_branch (employee_id, branch_id) VALUES
 (1,7),(2,7),(3,1),(4,1),(5,1),(6,2);
INSERT INTO sanction_limit (id, role_id, employee_id, limit_paise, reason, approved_by)
OVERRIDING SYSTEM VALUE VALUES
 (1,2,NULL,30000000,'Branch Manager standard limit ₹3,00,000',1);

-- —— masters: items, documents, charges, ledgers ——
INSERT INTO item (id, name, print_name, metal_id) OVERRIDING SYSTEM VALUE VALUES
 (1,'Bangle (Patlya)','Bangle',1),(2,'Chain (Gof)','Chain',1),(3,'Thushi','Thushi',1),
 (4,'Ring','Ring',1),(5,'Earring','Earring',1),(6,'Bor-Mala','Bor-Mala',1),
 (7,'Kada','Kada',1),(8,'Pendant (Shikka)','Pendant',1),(9,'Ranihar','Ranihar',1),
 (10,'Mangalsutra','Mangalsutra',1),(11,'Silver Item','Silver Item',2),(12,'Silver Kade','Silver Kade',2);

INSERT INTO document_type (id, name, category, is_ovd, expiry_tracked) OVERRIDING SYSTEM VALUE VALUES
 (1,'Aadhaar Card','id_proof',TRUE,FALSE),(2,'PAN Card','id_proof',TRUE,FALSE),
 (3,'Voter ID','id_proof',TRUE,FALSE),(4,'Driving License','id_proof',TRUE,TRUE),
 (5,'Passport','id_proof',TRUE,TRUE),
 (6,'Aadhaar Card','address_proof',TRUE,FALSE),(7,'Electricity Bill','address_proof',FALSE,FALSE),
 (8,'Ration Card','address_proof',FALSE,FALSE),(9,'Rent Agreement','address_proof',FALSE,TRUE),
 (10,'Bank Passbook','address_proof',FALSE,FALSE);

INSERT INTO ledger_group (id, name, nature, affects) OVERRIDING SYSTEM VALUE VALUES
 (1,'Loans & Advances (Asset)','assets','balance_sheet'),
 (2,'Cash-in-hand','assets','balance_sheet'),
 (3,'Bank Accounts','assets','balance_sheet'),
 (4,'Income (Indirect)','income','pnl'),
 (5,'Duties & Taxes','liabilities','balance_sheet');
INSERT INTO ledger (id, code, name, group_id, entity_id, branch_id, opening_paise, is_interest_income, is_rounding_income, is_cash_in_hand, is_gold_loan_asset)
OVERRIDING SYSTEM VALUE VALUES
 (1,'GL-PRIN-B1','Gold loan principal — B1',1,1,1,482000000,FALSE,FALSE,FALSE,TRUE),
 (2,'CASH-B1','Cash — B1 counter drawer',2,1,1,18450000,FALSE,FALSE,TRUE,FALSE),
 (3,'INT-INC','Interest income',4,1,NULL,0,TRUE,FALSE,FALSE,FALSE),
 (4,'ROUND-INC','Rounding income',4,1,NULL,0,FALSE,TRUE,FALSE,FALSE),
 (5,'PROC-INC','Processing fees',4,1,NULL,0,FALSE,FALSE,FALSE,FALSE),
 (6,'GST-PAY','GST payable',5,1,NULL,0,FALSE,FALSE,FALSE,FALSE),
 (7,'KKBK-CA-0021','Kotak current …0021',3,1,NULL,142000000,FALSE,FALSE,FALSE,FALSE),
 (8,'HDFC-CA-7740','HDFC current …7740',3,1,NULL,68000000,FALSE,FALSE,FALSE,FALSE),
 (9,'SBIN-CA-1902','SBI current …1902',3,1,NULL,31000000,FALSE,FALSE,FALSE,FALSE);

INSERT INTO charge_type (id, name, calc, amount_paise, pct, min_paise, max_paise, gst_pct, ledger_id) OVERRIDING SYSTEM VALUE VALUES
 (1,'Processing','flat',15000,NULL,NULL,NULL,18,5),
 (2,'Notice','flat',18000,NULL,NULL,NULL,0,5),
 (3,'Postage / Courier','flat',18000,NULL,NULL,NULL,0,5),
 (4,'Legal Notice','flat',100000,NULL,NULL,NULL,18,5),
 (5,'Auction','flat',100000,NULL,NULL,NULL,18,5),
 (6,'Lost Document','flat',12000,NULL,NULL,NULL,0,5),
 (7,'Document Charge %','pct_of_sanction',NULL,0.25,10000,150000,18,5);

INSERT INTO app_setting (key, value) VALUES
 ('valuer2_threshold_paise','2000000'),
 ('ho_routing_note','"limit engine = MIN(role, person)"'),
 ('same_admin_may_publish_scheme','false');

INSERT INTO pincode_directory (pincode, area, taluka, district, state) VALUES
 ('422502','Bhagur','Nashik','Nashik','Maharashtra'),
 ('422101','Nashik Road','Nashik','Nashik','Maharashtra'),
 ('422001','City Centre','Nashik','Nashik','Maharashtra'),
 ('411001','Camp','Pune City','Pune','Maharashtra');
INSERT INTO ifsc_directory (ifsc, bank, branch_name) VALUES
 ('KKBK0001896','Kotak Mahindra Bank','Sharanpur Rd, Nashik'),
 ('HDFC0000064','HDFC Bank','Nehru Rd, Bhagur'),
 ('SBIN0000386','State Bank of India','Main Br, Nashik');
INSERT INTO holiday (id, on_date, description) OVERRIDING SYSTEM VALUE VALUES
 (1,'2026-08-15','Independence Day'),(2,'2026-08-27','Ganesh Chaturthi');

-- —— schemes (with the Q&A-locked engine fields) ——
INSERT INTO scheme (id, code, name, metal_id) OVERRIDING SYSTEM VALUE VALUES
 (1,'GL2070','Gold loan 20% · fund 70%',1),
 (2,'GL2080','Gold loan 20% · fund 80%',1),
 (3,'GL2090','Gold loan 20% · fund 90%',1),
 (4,'SB-IND04','Slab 15/18/24',1);
INSERT INTO scheme_version (id, scheme_id, version_no, effective_from, funding_pct, calc_method,
  interest_pct, slab_mode, days_in_year, min_interest_days, round_step_paise, tenure_days,
  penal_rate_pct, penal_grace_days, capitalization_on,
  doc_charge_pct, doc_charge_min_paise, doc_charge_max_paise,
  min_loan_paise, max_loan_paise, status, maker_id, checker_id, published_at)
OVERRIDING SYSTEM VALUE VALUES
 (1,1,1,'2026-04-01',70,'simple',20,'retroactive',365,15,1000,365,2,7,FALSE,0.25,10000,150000,500000,100000000,'published',2,1,now()),
 (2,2,1,'2026-04-01',80,'simple',20,'retroactive',365,15,1000,365,2,7,FALSE,0.25,10000,150000,500000,100000000,'published',2,1,now()),
 (3,3,1,'2026-04-01',90,'simple',20,'retroactive',365,15,1000,365,2,7,FALSE,0.25,10000,150000,500000,100000000,'published',2,1,now()),
 (4,4,1,'2026-04-01',75,'slab',NULL,'retroactive',365,15,1000,185,2,7,TRUE,0.25,10000,150000,500000,100000000,'published',2,1,now());
INSERT INTO scheme_slab (scheme_version_id, from_day, to_day, rate_pct) VALUES
 (4,0,62,15),(4,63,123,18),(4,124,185,24);
INSERT INTO scheme_branch (scheme_version_id, branch_id)
SELECT sv.id, b.id FROM scheme_version sv CROSS JOIN branch b WHERE b.is_ho = FALSE;
INSERT INTO role_scheme (role_id, scheme_id)
SELECT r.id, s.id FROM role r CROSS JOIN scheme s WHERE r.id IN (1,2,3,4);

-- —— today's rate: 24K ₹12,100/g (maker Karanjkar, checker Lunawat) ——
INSERT INTO daily_rate (id, rate_date, metal_id, base_paise, source_ref, maker_id, checker_id)
OVERRIDING SYSTEM VALUE VALUES
 (1,'2026-07-25',1,1210000,'IBJA ref 12,148',2,1);

-- —— SLF disbursing accounts ——
INSERT INTO slf_bank_account (id, entity_id, branch_id, nickname, bank, ifsc, account_no_masked, ledger_id)
OVERRIDING SYSTEM VALUE VALUES
 (1,1,NULL,'Kotak current …0021','Kotak Mahindra Bank','KKBK0001896','xxxx0021',7),
 (2,1,NULL,'HDFC current …7740','HDFC Bank','HDFC0000064','xxxx7740',8),
 (3,1,NULL,'SBI current …1902','State Bank of India','SBIN0000386','xxxx1902',9);

-- —— number series (branch 01, FY 26-27) ——
INSERT INTO number_series (id, entity_id, branch_id, doc_type, fy_label, prefix, pad, next_no)
OVERRIDING SYSTEM VALUE VALUES
 (1,1,1,'loan','26-27','01A67',5,2300),
 (2,1,1,'receipt','26-27','RCPT-01-26-',5,842),
 (3,1,1,'packet','26-27','PKT-01-26-',4,4472),
 (4,1,1,'application','26-27','APP-01-26-',4,115);

-- —— customers (canon four) ——
INSERT INTO customer (id, cust_no, first_name, middle_name, last_name, gender, mobile,
  aadhaar_last4, aadhaar_verified_at, pan_no, pan_verified_at, kyc_done_at,
  max_open_loans, max_outstanding_paise, blacklist_narration, created_by)
OVERRIDING SYSTEM VALUE VALUES
 (1,'IND0012619','Prathmesh','Hanumanta','Kasar','male','7709046316','4821',now(),'AXXPP1938K',now(),'2024-08-12',3,50000000,NULL,4),
 (2,'IND0009402','Komal','Balasaheb','Mali','female','8975249307','7714',now(),'BLQPM4471C',now(),'2026-02-03',3,50000000,NULL,4),
 (3,'IND0007311','Archana','Sachin','Gaikwad','female','9420388121','2245',now(),'CGWPG8812F',now(),'2022-09-19',3,50000000,NULL,4),
 (4,'IND0004120','Rahul','Devidas','Shirsat','male','9028011934','9083',now(),'DKPPS2210J',now(),'2023-05-10',0,0,'Cheque dishonoured twice; gold auctioned 03-2025; shortfall ₹18,400',5);

INSERT INTO customer_address (customer_id, kind, line1, pincode, area, taluka, district, state) VALUES
 (1,'current','12 Gandhi Rd','422502','Bhagur','Nashik','Nashik','Maharashtra'),
 (2,'current','8 Station Rd','422101','Nashik Road','Nashik','Nashik','Maharashtra'),
 (3,'current','21 Market Lane','422001','City Centre','Nashik','Nashik','Maharashtra'),
 (4,'current','5 Old Bazar','422502','Bhagur','Nashik','Nashik','Maharashtra');

INSERT INTO customer_bank_account (id, customer_id, bank, account_no, ifsc, holder_name, verify_method, verified_at)
OVERRIDING SYSTEM VALUE VALUES
 (1,1,'Kotak Mahindra Bank','341790848722','KKBK0001896','Prathmesh Hanumanta Kasar','penny_drop',now()),
 (2,1,'HDFC Bank','50100224410','HDFC0000064','Prathmesh Kasar','none',NULL),
 (3,2,'State Bank of India','32100889903','SBIN0000386','Komal Balasaheb Mali','penny_drop',now()),
 (4,3,'Kotak Mahindra Bank','341788111188','KKBK0001896','Archana Sachin Gaikwad','penny_drop',now());

INSERT INTO nominee (customer_id, name, relation, mobile) VALUES
 (1,'Sunita Kasar','Wife','7709046300'),
 (2,'Balasaheb Mali','Father',NULL),
 (3,'Sachin Gaikwad','Husband','9420388100');

-- —— canon loans (day 80 / 33 / 5 as on 2026-07-25) + Lata (release) + Sanjay (vault-in due) ——
INSERT INTO customer (id, cust_no, first_name, last_name, mobile, kyc_done_at, max_open_loans, max_outstanding_paise, created_by)
OVERRIDING SYSTEM VALUE VALUES
 (5,'IND0011050','Lata','Pawar','9822455010','2025-01-15',3,50000000,4),
 (6,'IND0012801','Sanjay','Deshmukh','9822455011','2026-03-02',3,50000000,4);

INSERT INTO loan_application (id, app_no, entity_id, branch_id, customer_id, status,
  scheme_version_id, requested_paise, purpose, borrower_present, valuer1_id, valuer2_id,
  rate_date, base_paise_snapshot, created_by)
OVERRIDING SYSTEM VALUE VALUES
 (1,'APP-01-26-0101',1,1,1,'activated',4,10000000,'personal',TRUE,3,4,'2026-05-06',1180000,4),
 (2,'APP-01-26-0102',1,1,2,'activated',1, 2000000,'personal',TRUE,3,NULL,'2026-06-22',1195000,4),
 (3,'APP-01-26-0103',1,1,3,'activated',2, 5000000,'personal',TRUE,3,4,'2026-07-20',1208000,4),
 (4,'APP-01-26-0104',1,1,5,'activated',1, 6100000,'personal',TRUE,3,4,'2025-11-10',1050000,4),
 (5,'APP-01-26-0105',1,1,6,'activated',1, 4200000,'personal',TRUE,3,4,'2026-07-24',1210000,4);

INSERT INTO appraisal_item (application_id, item_id, qty, gross_mg, stone_mg, purity_id, purity_pct_snapshot, market_paise, funding_paise) VALUES
 (1,1,2,15800000,0,1,92,17590000,13190000),
 (1,2,1,16750000,400000,1,92,18200000,13650000),
 (2,4,1, 5500000,200000,3,83, 5330000, 3730000),
 (3,3,1,11400000,300000,1,92,12350000, 9880000),
 (4,1,1,12450000,0,1,92,11640000, 8150000),
 (5,7,1,12680000,200000,1,92,13910000, 9740000);

INSERT INTO loan (id, loan_no, application_id, entity_id, branch_id, customer_id,
  scheme_version_id, principal_paise, disbursed_at, status, closed_at, created_by)
OVERRIDING SYSTEM VALUE VALUES
 (1,'01A6598812',1,1,1,1,4,10000000,'2026-05-06','active',NULL,4),
 (2,'01A6702204',2,1,1,2,1, 2000000,'2026-06-22','active',NULL,4),
 (3,'01A6702291',3,1,1,3,2, 5000000,'2026-07-20','active',NULL,4),
 (4,'01A6543110',4,1,1,5,1, 6100000,'2025-11-10','closed','2026-07-24',4),
 (5,'01A6702288',5,1,1,6,1, 4200000,'2026-07-24','active',NULL,4);

INSERT INTO packet (id, packet_no, loan_id, sealed_at) OVERRIDING SYSTEM VALUE VALUES
 (1,'PKT-01-26-4402',1,'2026-05-07'),
 (2,'PKT-01-26-4431',2,'2026-06-23'),
 (3,'PKT-01-26-4466',3,'2026-07-21'),
 (4,'PKT-01-25-3987',4,'2025-11-11'),
 (5,'PKT-01-26-4468',5,NULL);                    -- Sanjay: vault-in due (no seal yet)

INSERT INTO vault_movement (packet_id, direction, safe_id, reason, at, by_employee) VALUES
 (1,'in',1,'vault_in','2026-05-07 11:20+05:30',5),
 (2,'in',1,'vault_in','2026-06-23 11:05+05:30',5),
 (3,'in',2,'vault_in','2026-07-21 10:40+05:30',5),
 (4,'in',1,'vault_in','2025-11-11 11:00+05:30',5);

INSERT INTO release (id, loan_id, due_from) OVERRIDING SYSTEM VALUE VALUES
 (1,4,'2026-07-24');                              -- Lata · day 2 as on 25-07

INSERT INTO loan_charge (id, loan_id, charge_type_id, base_paise, gst_paise, total_paise, floor_paise, narration, added_by)
OVERRIDING SYSTEM VALUE VALUES
 (1,1,1,15000,2700,17700,17700,'Processing at disbursement',4);

INSERT INTO day_cycle (id, branch_id, business_date, begin_opening_paise, begin_checks,
  begin_counted_paise, begin_signed_by, begin_signed_at,
  end_expected_paise, end_counted_paise, end_variance_paise, end_signed_by, end_signed_at)
OVERRIDING SYSTEM VALUE VALUES
 (1,1,'2026-07-24',18450000,'{"seal":true,"report":true,"rate":true,"queues":true}',
  18450000,5,'2026-07-24 09:05+05:30',
  18450000,18450000,0,5,'2026-07-24 19:32+05:30');

-- pending HO approval sample (above BM limit)
INSERT INTO customer (id, cust_no, first_name, last_name, mobile, kyc_done_at, max_open_loans, max_outstanding_paise, created_by)
OVERRIDING SYSTEM VALUE VALUES
 (7,'IND0012990','Nanda','Wagh','9822455012','2026-04-18',3,100000000,4);
INSERT INTO loan_application (id, app_no, entity_id, branch_id, customer_id, status,
  scheme_version_id, requested_paise, purpose, borrower_present, valuer1_id, valuer2_id,
  rate_date, base_paise_snapshot, created_by)
OVERRIDING SYSTEM VALUE VALUES
 (6,'APP-01-26-0114',1,1,7,'pending_ho',3,45000000,'business',TRUE,3,5,'2026-07-25',1210000,4);
INSERT INTO ho_approval (id, application_id, amount_paise, recommended_by)
OVERRIDING SYSTEM VALUE VALUES
 (1,6,45000000,5);

-- —— resync identity sequences after explicit ids ——
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['metal','purity','entity','branch','safe','employee','role',
    'sanction_limit','item','document_type','ledger_group','ledger','charge_type','holiday',
    'scheme','scheme_version','daily_rate','slf_bank_account','number_series','customer',
    'customer_bank_account','loan_application','loan','packet','release','loan_charge',
    'day_cycle','ho_approval'] LOOP
    EXECUTE format('SELECT setval(pg_get_serial_sequence(%L,''id''), COALESCE((SELECT MAX(id) FROM %I),1))', t, t);
  END LOOP;
END $$;

COMMIT;
