-- Analytics identity for new payment attempts and orders.
-- Does not backfill historical rows and does not store PostHog person/session ids.

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
