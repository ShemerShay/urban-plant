-- Admin and catalog visibility for an Offer that must stay in the database.
-- Historical orders, payments, and placements keep their foreign keys.
-- Application code does not set this while any POS still has current_offer_id.
-- This column does not change offer id, price, or status.

BEGIN;

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS admin_hidden boolean NOT NULL DEFAULT false;

COMMIT;
