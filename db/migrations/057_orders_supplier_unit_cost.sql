-- Partner and Flower supplier cost frozen at payment prep.
-- Catalog cost stays on order_items. Existing orders are not backfilled.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS supplier_unit_cost numeric(10, 2);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS supplier_unit_cost_source text;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_supplier_unit_cost_non_negative;

ALTER TABLE orders
  ADD CONSTRAINT orders_supplier_unit_cost_non_negative
  CHECK (supplier_unit_cost IS NULL OR supplier_unit_cost >= 0);

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_supplier_unit_cost_source_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_supplier_unit_cost_source_check
  CHECK (
    supplier_unit_cost_source IS NULL
    OR supplier_unit_cost_source = 'plants.supplier_price@sale'
  );

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_supplier_unit_cost_pair_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_supplier_unit_cost_pair_check
  CHECK (
    (supplier_unit_cost IS NULL AND supplier_unit_cost_source IS NULL)
    OR (supplier_unit_cost IS NOT NULL AND supplier_unit_cost_source IS NOT NULL)
  );

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_catalog_supplier_cost_null_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_catalog_supplier_cost_null_check
  CHECK (channel <> 'catalog' OR supplier_unit_cost IS NULL);
