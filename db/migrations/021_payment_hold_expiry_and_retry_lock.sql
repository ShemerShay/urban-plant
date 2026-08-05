-- Payment hold expiry + retry lock for Cardcom integrity.
-- Safe for existing rows: new columns nullable.

-- When POS entered held_for_payment (for 5-minute abandoned-hold expiry).
ALTER TABLE pos_spots
  ADD COLUMN IF NOT EXISTS payment_hold_started_at timestamptz;

-- Set for any spots already held (best-effort: treat as starting now so they get a full window).
UPDATE pos_spots
SET payment_hold_started_at = now()
WHERE status = 'held_for_payment'
  AND payment_hold_started_at IS NULL;

-- Concurrent retry claim: only one Cardcom Create at a time per pending order.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_retry_lock_at timestamptz;
