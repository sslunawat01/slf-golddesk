-- E16 №6 (owner, 29 Aug 2026): branch code may be 2 OR 3 characters.
-- E14 changed the form and masters.js but forgot this third enforcement
-- layer — "enforce twice" means ALL layers move together. Lesson relearned.
ALTER TABLE branch DROP CONSTRAINT IF EXISTS branch_code_2char;
ALTER TABLE branch ADD CONSTRAINT branch_code_2_3char
  CHECK (is_ho OR code ~ '^[A-Z0-9]{2,3}$');
