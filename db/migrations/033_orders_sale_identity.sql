-- Sale identity: Partner vs Catalog channel, plus the owning Partner for Partner sales.
-- Existing rows are Partner sales. Do not default channel after backfill.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS partner_id text REFERENCES partners (id);

UPDATE orders o
SET
  channel = 'partner',
  partner_id = pl.partner_id
FROM partner_locations pl
WHERE pl.id = o.partner_location_id
  AND (o.channel IS NULL OR o.partner_id IS NULL);

ALTER TABLE orders
  ALTER COLUMN channel SET NOT NULL;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_channel_check,
  ADD CONSTRAINT orders_channel_check
    CHECK (channel IN ('partner', 'catalog'));

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_sale_identity_check,
  ADD CONSTRAINT orders_sale_identity_check
    CHECK (
      (channel = 'partner' AND partner_id IS NOT NULL)
      OR
      (channel = 'catalog' AND partner_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS orders_channel_created_at_idx
  ON orders (channel, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_partner_id_created_at_idx
  ON orders (partner_id, created_at DESC);
