-- Speed up scheduled stale payment-hold scans.
-- Candidate set is small (held_for_payment only); partial index keeps lookups cheap.

CREATE INDEX IF NOT EXISTS pos_spots_stale_payment_hold_idx
  ON pos_spots (payment_hold_started_at)
  WHERE status = 'held_for_payment';
