-- Enforce: held_for_payment always has payment_hold_started_at.
-- Safe: writers set/clear the timestamp; production had 0 violating rows at audit time.

-- Backfill any stragglers before the CHECK (idempotent).
UPDATE pos_spots
SET payment_hold_started_at = COALESCE(payment_hold_started_at, now())
WHERE status = 'held_for_payment'
  AND payment_hold_started_at IS NULL;

ALTER TABLE pos_spots
  DROP CONSTRAINT IF EXISTS pos_spots_held_for_payment_requires_hold_started_at;

ALTER TABLE pos_spots
  ADD CONSTRAINT pos_spots_held_for_payment_requires_hold_started_at
  CHECK (
    status <> 'held_for_payment'
    OR payment_hold_started_at IS NOT NULL
  );
