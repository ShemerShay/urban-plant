-- Plant supplier cost belongs only to Plant Size (plant_variants).
-- Backfill existing sizes from plants.supplier_price, then drop that plant column.
-- Do not rewrite historical placement/order snapshots.
-- Old snapshot source strings stay valid; new writes use plant_variants sources.

BEGIN;

ALTER TABLE plant_variants
  ADD COLUMN IF NOT EXISTS supplier_price numeric(10, 2);

ALTER TABLE plant_variants
  DROP CONSTRAINT IF EXISTS plant_variants_supplier_price_nonneg;

ALTER TABLE plant_variants
  ADD CONSTRAINT plant_variants_supplier_price_nonneg
  CHECK (supplier_price IS NULL OR supplier_price >= 0);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'plants'
      AND column_name = 'supplier_price'
  ) THEN
    UPDATE plant_variants pv
    SET supplier_price = p.supplier_price
    FROM plants p
    WHERE pv.plant_id = p.id
      AND pv.supplier_price IS NULL
      AND p.supplier_price IS NOT NULL
      AND p.supplier_price >= 0;

    ALTER TABLE plants DROP CONSTRAINT IF EXISTS plants_supplier_price_nonneg;
    ALTER TABLE plants DROP COLUMN IF EXISTS supplier_price;
  END IF;
END $$;

ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_plant_unit_cost_source_check;

ALTER TABLE order_items
  ADD CONSTRAINT order_items_plant_unit_cost_source_check
  CHECK (
    plant_unit_cost_source IS NULL
    OR plant_unit_cost_source = 'plants.supplier_price@sale'
    OR plant_unit_cost_source = 'plant_variants.supplier_price@sale'
  );

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_supplier_unit_cost_source_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_supplier_unit_cost_source_check
  CHECK (
    supplier_unit_cost_source IS NULL
    OR supplier_unit_cost_source = 'plants.supplier_price@sale'
    OR supplier_unit_cost_source = 'plant_variants.supplier_price@sale'
  );

ALTER TABLE placement_segments
  DROP CONSTRAINT IF EXISTS placement_segments_plant_unit_cost_source_check;

ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_plant_unit_cost_source_check
  CHECK (
    plant_unit_cost_source IS NULL
    OR plant_unit_cost_source = 'plants.supplier_price@cycle'
    OR plant_unit_cost_source = 'plant_variants.supplier_price@cycle'
  );

COMMIT;
