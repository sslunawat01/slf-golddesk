-- 009_packet_backfill.sql
-- Packets are created at disbursement from 008 onward. The loans disbursed
-- during testing on 27 July have none, so they would never appear on the
-- vault-in list. Give each one a packet number from the proper series.

BEGIN;

DO $$
DECLARE
  r      RECORD;
  v_fy   text;
  v_no   text;
BEGIN
  FOR r IN
    SELECT l.id, l.entity_id, l.branch_id, l.disbursed_at
      FROM loan l
     WHERE l.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM packet p WHERE p.loan_id = l.id)
     ORDER BY l.id
  LOOP
    -- financial year of the disbursement, April–March, as '26-27'
    v_fy := CASE WHEN EXTRACT(MONTH FROM r.disbursed_at) >= 4
                 THEN to_char(r.disbursed_at, 'YY') || '-' ||
                      to_char(r.disbursed_at + INTERVAL '1 year', 'YY')
                 ELSE to_char(r.disbursed_at - INTERVAL '1 year', 'YY') || '-' ||
                      to_char(r.disbursed_at, 'YY')
            END;
    v_no := issue_number(r.entity_id, r.branch_id, 'packet'::series_doc, v_fy);
    INSERT INTO packet (packet_no, loan_id, status) VALUES (v_no, r.id, 'at_counter');
  END LOOP;
END $$;

COMMIT;
