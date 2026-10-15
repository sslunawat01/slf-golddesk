-- 034 (E34, owner 15 Oct 2026) — a rate published twice on one day is a CORRECTION,
-- recorded as a second append-only row (rule 4: facts are never deleted). The old
-- UNIQUE (rate_date, metal_id) forced the publish route to DELETE today's row, which
-- the frozen-table trigger refused — a same-day correction raised a raw 500 (O-A).
-- rate_in_force() already orders by rate_date DESC, published_at DESC, so the latest
-- publish of the day wins with no further change.
ALTER TABLE daily_rate DROP CONSTRAINT IF EXISTS daily_rate_rate_date_metal_id_key;
CREATE INDEX IF NOT EXISTS idx_daily_rate_force ON daily_rate (metal_id, rate_date DESC, published_at DESC);
