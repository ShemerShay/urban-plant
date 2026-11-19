-- Catalog checkout data foundations.
-- Payment attempts can be partner (POS) or catalog.
-- Catalog holds reserve central plant-variant stock without decrementing it.
-- order_items keep historical line snapshots. Catalog/pot deletion must not remove them.

-- Existing POS rows have a spot. Default channel keeps current inserts valid.
ALTER TABLE payment_attempts
  ALTER COLUMN pos_spot_id DROP NOT NULL;

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS channel text;

UPDATE payment_attempts
SET channel = 'partner'
WHERE channel IS NULL;

ALTER TABLE payment_attempts
  ALTER COLUMN channel SET NOT NULL;

ALTER TABLE payment_attempts
  ALTER COLUMN channel SET DEFAULT 'partner';

ALTER TABLE payment_attempts
  ADD COLUMN IF NOT EXISTS catalog_snapshot jsonb;

ALTER TABLE payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_channel_check;

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_channel_check
  CHECK (channel IN ('partner', 'catalog'));

ALTER TABLE payment_attempts
  DROP CONSTRAINT IF EXISTS payment_attempts_channel_pos_spot_check;

ALTER TABLE payment_attempts
  ADD CONSTRAINT payment_attempts_channel_pos_spot_check
  CHECK (
    (channel = 'partner' AND pos_spot_id IS NOT NULL)
    OR (channel = 'catalog' AND pos_spot_id IS NULL)
  );

CREATE TABLE IF NOT EXISTS catalog_stock_holds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id        uuid NOT NULL REFERENCES payment_attempts (id) ON DELETE CASCADE,
  plant_variant_id  uuid NOT NULL REFERENCES plant_variants (id) ON DELETE RESTRICT,
  quantity          integer NOT NULL,
  status            text NOT NULL,
  expires_at        timestamptz NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalog_stock_holds_quantity_positive
    CHECK (quantity > 0),
  CONSTRAINT catalog_stock_holds_status_check
    CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  CONSTRAINT catalog_stock_holds_attempt_variant_key
    UNIQUE (attempt_id, plant_variant_id)
);

-- Availability reads active holds for a plant variant. Pots are not held.
CREATE INDEX IF NOT EXISTS catalog_stock_holds_active_variant_idx
  ON catalog_stock_holds (plant_variant_id, expires_at)
  WHERE status = 'active';

-- Historical catalog lines. No FKs to plants, plant_variants, or pot_variants:
-- deleting catalog or pot rows must leave these snapshots in place.
CREATE TABLE IF NOT EXISTS order_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid NOT NULL REFERENCES orders (order_id) ON DELETE RESTRICT,
  line_no                 integer NOT NULL,
  plant_id                text NOT NULL,
  plant_variant_id        uuid NOT NULL,
  pot_variant_id          uuid,
  quantity                integer NOT NULL,
  plant_unit_price        numeric(10, 2) NOT NULL,
  pot_unit_price          numeric(10, 2),
  line_total              numeric(10, 2) NOT NULL,
  currency                text NOT NULL,
  plant_name              text NOT NULL,
  plant_name_he           text,
  size_label              text,
  pot_name                text,
  pot_color               text,
  plant_unit_cost         numeric(10, 2),
  plant_unit_cost_source  text,
  CONSTRAINT order_items_order_line_key
    UNIQUE (order_id, line_no),
  CONSTRAINT order_items_line_no_positive
    CHECK (line_no > 0),
  CONSTRAINT order_items_quantity_positive
    CHECK (quantity > 0),
  CONSTRAINT order_items_plant_unit_price_positive
    CHECK (plant_unit_price > 0),
  CONSTRAINT order_items_pot_unit_price_positive
    CHECK (pot_unit_price IS NULL OR pot_unit_price > 0),
  CONSTRAINT order_items_pot_price_pair_check
    CHECK (
      (pot_variant_id IS NULL AND pot_unit_price IS NULL)
      OR (pot_variant_id IS NOT NULL AND pot_unit_price IS NOT NULL)
    ),
  CONSTRAINT order_items_line_total_positive
    CHECK (line_total > 0),
  CONSTRAINT order_items_line_total_check
    CHECK (line_total = (plant_unit_price + COALESCE(pot_unit_price, 0)) * quantity),
  CONSTRAINT order_items_currency_check
    CHECK (currency IN ('ILS', 'USD', 'EUR')),
  CONSTRAINT order_items_plant_name_not_blank
    CHECK (length(trim(plant_name)) > 0),
  CONSTRAINT order_items_plant_name_he_not_blank
    CHECK (plant_name_he IS NULL OR length(trim(plant_name_he)) > 0),
  CONSTRAINT order_items_size_label_not_blank
    CHECK (size_label IS NULL OR length(trim(size_label)) > 0),
  CONSTRAINT order_items_pot_name_not_blank
    CHECK (pot_name IS NULL OR length(trim(pot_name)) > 0),
  CONSTRAINT order_items_pot_color_not_blank
    CHECK (pot_color IS NULL OR length(trim(pot_color)) > 0),
  CONSTRAINT order_items_plant_unit_cost_positive
    CHECK (plant_unit_cost IS NULL OR plant_unit_cost > 0),
  CONSTRAINT order_items_plant_unit_cost_source_check
    CHECK (
      plant_unit_cost_source IS NULL
      OR plant_unit_cost_source = 'plants.supplier_price@sale'
    ),
  CONSTRAINT order_items_plant_unit_cost_pair_check
    CHECK (
      (plant_unit_cost IS NULL AND plant_unit_cost_source IS NULL)
      OR (plant_unit_cost IS NOT NULL AND plant_unit_cost_source IS NOT NULL)
    )
);
