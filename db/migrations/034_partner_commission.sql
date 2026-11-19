-- Partner live commission agreement (tiers) and assigned order rate.
-- Current deals are one unbounded 0% tier per Partner. Do not add Alon Shabo 10/12/14 here.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS commission_rate numeric(5, 2);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_commission_rate_range_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_commission_rate_range_check
    CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 100));

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_catalog_commission_null_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_catalog_commission_null_check
    CHECK (channel <> 'catalog' OR commission_rate IS NULL);

CREATE TABLE IF NOT EXISTS partner_commission_tiers (
  id               text PRIMARY KEY,
  partner_id       text NOT NULL REFERENCES partners (id),
  min_units        integer NOT NULL,
  max_units        integer,
  commission_rate  numeric(5, 2) NOT NULL,
  CONSTRAINT partner_commission_tiers_min_units_check
    CHECK (min_units >= 1),
  CONSTRAINT partner_commission_tiers_max_units_check
    CHECK (max_units IS NULL OR max_units >= min_units),
  CONSTRAINT partner_commission_tiers_rate_check
    CHECK (commission_rate >= 0 AND commission_rate <= 100)
);

CREATE INDEX IF NOT EXISTS partner_commission_tiers_partner_id_idx
  ON partner_commission_tiers (partner_id);

INSERT INTO partner_commission_tiers (id, partner_id, min_units, max_units, commission_rate)
SELECT 'commission-zero-' || id, id, 1, NULL, 0
FROM partners
WHERE NOT EXISTS (
  SELECT 1
  FROM partner_commission_tiers t
  WHERE t.partner_id = partners.id
);

UPDATE orders o
SET commission_rate = 0
WHERE o.channel = 'partner'
  AND o.commission_rate IS NULL
  AND COALESCE(
    (SELECT p.inventory_type FROM plants p WHERE p.id = o.product_id),
    'plants'
  ) = 'plants';
