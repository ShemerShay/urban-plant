-- Catalog Pot is the physical SKU.
-- Sellable Variant identity becomes Plant Size + optional pots.id.
-- Pot inventory and history hang off the pot. Size and color tables go away.
-- Aborts with no schema change when any size, color, inventory, or live reference exists.
-- Does not insert stock. Does not touch order snapshot text.

DO $migration$
DECLARE
  n integer;
BEGIN
  IF to_regclass('public.pot_sizes') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM pot_sizes' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: pot_sizes rows exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF to_regclass('public.pot_colors') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM pot_colors' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: pot_colors rows exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF to_regclass('public.pot_inventory') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM pot_inventory' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: pot_inventory rows exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF to_regclass('public.pot_inventory_history') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM pot_inventory_history' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: pot_inventory_history rows exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sellable_variants' AND column_name = 'pot_size_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM sellable_variants WHERE pot_size_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: sellable variant pot sizes exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pos_spots' AND column_name = 'pot_color_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM pos_spots WHERE pot_color_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: pos pot colors exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'placement_segments' AND column_name = 'pot_color_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM placement_segments WHERE pot_color_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: placement pot colors exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'catalog_stock_holds' AND column_name = 'pot_color_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM catalog_stock_holds WHERE pot_color_id IS NOT NULL' INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'catalog pot sku blocked: catalog pot-color holds exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'pot_size_id'
    ) THEN
      EXECUTE 'SELECT count(*) FROM order_items WHERE pot_size_id IS NOT NULL OR pot_color_id IS NOT NULL' INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'catalog pot sku blocked: order item pot size or color ids exist' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  ALTER TABLE pots
    ADD COLUMN IF NOT EXISTS supplier_price numeric(10, 2);

  ALTER TABLE pots DROP CONSTRAINT IF EXISTS pots_supplier_price_non_negative;
  ALTER TABLE pots
    ADD CONSTRAINT pots_supplier_price_non_negative
    CHECK (supplier_price IS NULL OR supplier_price >= 0);

  ALTER TABLE sellable_variants
    ADD COLUMN IF NOT EXISTS pot_id uuid;

  ALTER TABLE sellable_variants DROP CONSTRAINT IF EXISTS sellable_variants_pot_id_fkey;
  ALTER TABLE sellable_variants
    ADD CONSTRAINT sellable_variants_pot_id_fkey
    FOREIGN KEY (pot_id) REFERENCES pots (id) ON DELETE RESTRICT;

  ALTER TABLE sellable_variants DROP CONSTRAINT IF EXISTS sellable_variants_plant_size_pot_size_key;
  ALTER TABLE sellable_variants DROP CONSTRAINT IF EXISTS sellable_variants_plant_size_pot_key;
  ALTER TABLE sellable_variants
    ADD CONSTRAINT sellable_variants_plant_size_pot_key
    UNIQUE NULLS NOT DISTINCT (plant_variant_id, pot_id);

  DROP INDEX IF EXISTS sellable_variants_pot_size_id_idx;
  ALTER TABLE sellable_variants DROP COLUMN IF EXISTS pot_size_id;

  CREATE INDEX IF NOT EXISTS sellable_variants_pot_id_idx
    ON sellable_variants (pot_id);

  DROP TRIGGER IF EXISTS pos_spots_occupancy_offer_color ON pos_spots;

  ALTER TABLE pos_spots DROP CONSTRAINT IF EXISTS pos_spots_pot_color_requires_plant;
  ALTER TABLE pos_spots DROP CONSTRAINT IF EXISTS pos_spots_pot_id_requires_plant;
  ALTER TABLE pos_spots DROP CONSTRAINT IF EXISTS pos_spots_pot_color_id_fkey;
  ALTER TABLE pos_spots DROP CONSTRAINT IF EXISTS pos_spots_pot_id_fkey;
  DROP INDEX IF EXISTS pos_spots_pot_color_id_idx;
  ALTER TABLE pos_spots DROP COLUMN IF EXISTS pot_color_id;
  ALTER TABLE pos_spots ADD COLUMN IF NOT EXISTS pot_id uuid;
  ALTER TABLE pos_spots
    ADD CONSTRAINT pos_spots_pot_id_fkey
    FOREIGN KEY (pot_id) REFERENCES pots (id) ON DELETE RESTRICT;
  ALTER TABLE pos_spots
    ADD CONSTRAINT pos_spots_pot_id_requires_plant
    CHECK (pot_id IS NULL OR plant_variant_id IS NOT NULL);
  CREATE INDEX IF NOT EXISTS pos_spots_pot_id_idx
    ON pos_spots (pot_id)
    WHERE pot_id IS NOT NULL;

  ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pot_color_id_fkey;
  ALTER TABLE placement_segments DROP CONSTRAINT IF EXISTS placement_segments_pot_id_fkey;
  ALTER TABLE placement_segments DROP COLUMN IF EXISTS pot_color_id;
  ALTER TABLE placement_segments ADD COLUMN IF NOT EXISTS pot_id uuid;
  ALTER TABLE placement_segments
    ADD CONSTRAINT placement_segments_pot_id_fkey
    FOREIGN KEY (pot_id) REFERENCES pots (id) ON DELETE RESTRICT;

  ALTER TABLE catalog_stock_holds DROP CONSTRAINT IF EXISTS catalog_stock_holds_one_resource_check;
  ALTER TABLE catalog_stock_holds DROP CONSTRAINT IF EXISTS catalog_stock_holds_pot_color_id_fkey;
  ALTER TABLE catalog_stock_holds DROP CONSTRAINT IF EXISTS catalog_stock_holds_pot_id_fkey;
  DROP INDEX IF EXISTS catalog_stock_holds_attempt_color_key;
  DROP INDEX IF EXISTS catalog_stock_holds_active_color_idx;
  ALTER TABLE catalog_stock_holds DROP COLUMN IF EXISTS pot_color_id;
  ALTER TABLE catalog_stock_holds ADD COLUMN IF NOT EXISTS pot_id uuid;
  ALTER TABLE catalog_stock_holds
    ADD CONSTRAINT catalog_stock_holds_pot_id_fkey
    FOREIGN KEY (pot_id) REFERENCES pots (id) ON DELETE RESTRICT;
  ALTER TABLE catalog_stock_holds
    ADD CONSTRAINT catalog_stock_holds_one_resource_check
    CHECK (
      (plant_variant_id IS NOT NULL AND pot_id IS NULL)
      OR (plant_variant_id IS NULL AND pot_id IS NOT NULL)
    );
  CREATE UNIQUE INDEX IF NOT EXISTS catalog_stock_holds_attempt_pot_key
    ON catalog_stock_holds (attempt_id, pot_id)
    WHERE pot_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS catalog_stock_holds_active_pot_idx
    ON catalog_stock_holds (pot_id, expires_at)
    WHERE status = 'active' AND pot_id IS NOT NULL;

  DROP TABLE IF EXISTS pot_inventory_history;
  DROP TABLE IF EXISTS pot_inventory;
  DROP TABLE IF EXISTS pot_colors;
  DROP TABLE IF EXISTS pot_sizes;

  CREATE TABLE pot_inventory (
    pot_id      uuid PRIMARY KEY REFERENCES pots (id) ON DELETE CASCADE,
    quantity    integer NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pot_inventory_quantity_non_negative CHECK (quantity >= 0)
  );

  CREATE TABLE pot_inventory_history (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pot_id      uuid NOT NULL REFERENCES pots (id) ON DELETE CASCADE,
    delta       integer NOT NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pot_inventory_history_delta_nonzero CHECK (delta <> 0)
  );

  CREATE INDEX pot_inventory_history_pot_created_at_idx
    ON pot_inventory_history (pot_id, created_at DESC);

  IF to_regclass('public.order_items') IS NOT NULL THEN
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pot_id uuid;
    ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_pot_unit_cost_source_check;
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_pot_unit_cost_source_check
      CHECK (
        pot_unit_cost_source IS NULL
        OR pot_unit_cost_source = 'pot_sizes.supplier_price@sale'
        OR pot_unit_cost_source = 'pots.supplier_price@sale'
      );
  END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION enforce_pos_occupancy_offer_pot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $pos_occupancy_pot$
DECLARE
  v_sellable uuid;
  v_plant_size uuid;
  v_pot uuid;
BEGIN
  IF NEW.plant_variant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.sellable_variant_id
    INTO v_sellable
  FROM offers o
  WHERE o.id = NEW.current_offer_id;

  IF v_sellable IS NULL THEN
    IF NEW.pot_id IS NOT NULL THEN
      RAISE EXCEPTION 'legacy occupancy cannot store a pot'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT sv.plant_variant_id, sv.pot_id
    INTO v_plant_size, v_pot
  FROM sellable_variants sv
  WHERE sv.id = v_sellable;

  IF NEW.plant_variant_id IS DISTINCT FROM v_plant_size THEN
    RAISE EXCEPTION 'plant size must match the offer sellable variant'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.pot_id IS DISTINCT FROM v_pot THEN
    RAISE EXCEPTION 'pot must match the offer sellable variant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$pos_occupancy_pot$;

DROP TRIGGER IF EXISTS pos_spots_occupancy_offer_color ON pos_spots;
DROP TRIGGER IF EXISTS pos_spots_occupancy_offer_pot ON pos_spots;
CREATE TRIGGER pos_spots_occupancy_offer_pot
  BEFORE INSERT OR UPDATE ON pos_spots
  FOR EACH ROW
  EXECUTE FUNCTION enforce_pos_occupancy_offer_pot();

CREATE OR REPLACE FUNCTION assert_pot_central_quantity_available(p_pot_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $assert_pot_qty$
DECLARE
  qty integer;
BEGIN
  PERFORM id FROM pots WHERE id = p_pot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This pot is out of stock' USING ERRCODE = 'P0001';
  END IF;
  SELECT quantity INTO qty FROM pot_inventory WHERE pot_id = p_pot_id FOR UPDATE;
  IF COALESCE(qty, 0) <= 0 THEN
    RAISE EXCEPTION 'This pot is out of stock' USING ERRCODE = 'P0001';
  END IF;
END;
$assert_pot_qty$;
