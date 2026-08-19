-- 015: №18 — who physically handed over the money. Often not the borrower:
-- a son, a neighbour, an agent. Free text on the receipt, frozen with the row.
-- ALTER passes the fn_forbid_mutation trigger (it blocks UPDATE/DELETE, not DDL).
ALTER TABLE receipt ADD COLUMN IF NOT EXISTS paid_by text;
