-- Catalog cutover: plant-size and pot-color holds, one order-line selling price.
-- Aborts with no schema change while a catalog attempt can still complete.
-- Does not invent Offers, Variants, colors, or stock.
-- Does not round historical money. Aborts if unit_price * quantity would not
-- reproduce line_total exactly.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM payment_attempts
    WHERE channel = 'catalog'
      AND status IN ('created', 'awaiting_payment')
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'catalog cutover blocked: in-flight catalog payment attempts'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.order_items') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM order_items
    WHERE (plant_unit_price + COALESCE(pot_unit_price, 0)) * quantity
      IS DISTINCT FROM line_total
  ) THEN
    RAISE EXCEPTION 'catalog cutover blocked: unit_price would not reproduce line_total'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE pot_sizes DROP CONSTRAINT IF EXISTS pot_sizes_supplier_price_positive;

ALTER TABLE pot_sizes DROP CONSTRAINT IF EXISTS pot_sizes_supplier_price_non_negative;

ALTER TABLE pot_sizes
  ADD CONSTRAINT pot_sizes_supplier_price_non_negative
  CHECK (supplier_price IS NULL OR supplier_price >= 0);

ALTER TABLE catalog_stock_holds
  ALTER COLUMN plant_variant_id DROP NOT NULL;

ALTER TABLE catalog_stock_holds
  ADD COLUMN IF NOT EXISTS pot_color_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'catalog_stock_holds_pot_color_id_fkey'
  ) THEN
    ALTER TABLE catalog_stock_holds
      ADD CONSTRAINT catalog_stock_holds_pot_color_id_fkey
      FOREIGN KEY (pot_color_id) REFERENCES pot_colors (id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE catalog_stock_holds
  DROP CONSTRAINT IF EXISTS catalog_stock_holds_attempt_variant_key;

ALTER TABLE catalog_stock_holds
  DROP CONSTRAINT IF EXISTS catalog_stock_holds_one_resource_check;

ALTER TABLE catalog_stock_holds
  ADD CONSTRAINT catalog_stock_holds_one_resource_check
  CHECK (
    (plant_variant_id IS NOT NULL AND pot_color_id IS NULL)
    OR (plant_variant_id IS NULL AND pot_color_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS catalog_stock_holds_attempt_plant_key
  ON catalog_stock_holds (attempt_id, plant_variant_id)
  WHERE plant_variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_stock_holds_attempt_color_key
  ON catalog_stock_holds (attempt_id, pot_color_id)
  WHERE pot_color_id IS NOT NULL;

DROP INDEX IF EXISTS catalog_stock_holds_active_variant_idx;

CREATE INDEX IF NOT EXISTS catalog_stock_holds_active_variant_idx
  ON catalog_stock_holds (plant_variant_id, expires_at)
  WHERE status = 'active' AND plant_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_stock_holds_active_color_idx
  ON catalog_stock_holds (pot_color_id, expires_at)
  WHERE status = 'active' AND pot_color_id IS NOT NULL;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS unit_price numeric(10, 2);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS offer_id text;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS sellable_variant_id uuid;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pot_size_id uuid;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pot_color_id uuid;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pot_size_label text;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pot_color_he text;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pot_unit_cost numeric(10, 2);

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS pot_unit_cost_source text;

UPDATE order_items
SET unit_price = plant_unit_price + COALESCE(pot_unit_price, 0)
WHERE unit_price IS NULL
  AND plant_unit_price IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.order_items') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM order_items
    WHERE unit_price IS NULL
      OR unit_price * quantity IS DISTINCT FROM line_total
  ) THEN
    RAISE EXCEPTION 'catalog cutover blocked: unit_price does not reproduce line_total'
      USING ERRCODE = 'P0001';
  END IF;
END $$;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_plant_unit_price_positive;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_unit_price_positive;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_price_pair_check;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_line_total_check;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_plant_unit_cost_positive;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_unit_price_positive;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_plant_unit_cost_non_negative;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_unit_cost_non_negative;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_unit_cost_source_check;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_unit_cost_pair_check;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_size_label_not_blank;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_color_he_not_blank;

ALTER TABLE order_items DROP COLUMN IF EXISTS plant_unit_price;
ALTER TABLE order_items DROP COLUMN IF EXISTS pot_unit_price;
ALTER TABLE order_items DROP COLUMN IF EXISTS pot_variant_id;

ALTER TABLE order_items
  ALTER COLUMN unit_price SET NOT NULL;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_unit_price_positive
  CHECK (unit_price > 0);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_line_total_check
  CHECK (line_total = unit_price * quantity);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_plant_unit_cost_non_negative
  CHECK (plant_unit_cost IS NULL OR plant_unit_cost >= 0);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_pot_unit_cost_non_negative
  CHECK (pot_unit_cost IS NULL OR pot_unit_cost >= 0);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_pot_unit_cost_source_check
  CHECK (
    pot_unit_cost_source IS NULL
    OR pot_unit_cost_source = 'pot_sizes.supplier_price@sale'
  );

ALTER TABLE order_items
  ADD CONSTRAINT order_items_pot_unit_cost_pair_check
  CHECK (
    (pot_unit_cost IS NULL AND pot_unit_cost_source IS NULL)
    OR (pot_unit_cost IS NOT NULL AND pot_unit_cost_source IS NOT NULL)
  );

ALTER TABLE order_items
  ADD CONSTRAINT order_items_pot_size_label_not_blank
  CHECK (pot_size_label IS NULL OR length(trim(pot_size_label)) > 0);

ALTER TABLE order_items
  ADD CONSTRAINT order_items_pot_color_he_not_blank
  CHECK (pot_color_he IS NULL OR length(trim(pot_color_he)) > 0);

COMMIT;
