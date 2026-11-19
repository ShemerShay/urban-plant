-- Slice 7: drop unused pre-Offer catalog leftovers.
-- Does not copy catalog_price, average_size, offers.variant_id, or pot_variants
-- into Offers, Sellable Variants, or inventory.

BEGIN;

DO $notice$
DECLARE
  n_variant int := 0;
  n_catalog int := 0;
  n_average int := 0;
  n_pots int := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'offers' AND column_name = 'variant_id'
  ) THEN
    EXECUTE 'SELECT count(*) FROM offers WHERE variant_id IS NOT NULL' INTO n_variant;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plant_variants' AND column_name = 'catalog_price'
  ) THEN
    EXECUTE 'SELECT count(*) FROM plant_variants WHERE catalog_price IS NOT NULL' INTO n_catalog;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'plants' AND column_name = 'average_size'
  ) THEN
    EXECUTE 'SELECT count(*) FROM plants WHERE average_size IS NOT NULL' INTO n_average;
  END IF;

  IF to_regclass('public.pot_variants') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM pot_variants' INTO n_pots;
  END IF;

  RAISE NOTICE 'slice 7 leftover offers.variant_id=% plant_variants.catalog_price=% plants.average_size=% pot_variants=%',
    n_variant, n_catalog, n_average, n_pots;
END
$notice$;

CREATE OR REPLACE FUNCTION apply_plant_offer(
  p_offer_id text,
  p_sellable_variant_id uuid,
  p_consumer_price numeric,
  p_status text,
  p_availabilities jsonb
) RETURNS TABLE (offer_id text, reused boolean)
LANGUAGE plpgsql
SET search_path = public
AS $apply_plant_offer$
DECLARE
  v_plant_id text;
  v_price numeric(10, 2);
  v_existing_id text;
  v_reused boolean := false;
  v_item jsonb;
BEGIN
  IF p_status NOT IN ('active', 'inactive') THEN
    RAISE EXCEPTION 'status must be active or inactive'
      USING ERRCODE = '23514';
  END IF;

  v_price := p_consumer_price;

  SELECT pv.plant_id
    INTO v_plant_id
  FROM sellable_variants sv
  INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
  WHERE sv.id = p_sellable_variant_id
  FOR UPDATE OF sv;

  IF v_plant_id IS NULL THEN
    RAISE EXCEPTION 'sellable variant not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT o.id
    INTO v_existing_id
  FROM offers o
  WHERE o.sellable_variant_id = p_sellable_variant_id
    AND o.consumer_price = v_price
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    v_reused := true;
    UPDATE offers
    SET status = p_status
    WHERE id = v_existing_id;
  ELSE
    INSERT INTO offers (
      id,
      product_id,
      sellable_variant_id,
      consumer_price,
      status,
      created_at
    ) VALUES (
      p_offer_id,
      v_plant_id,
      p_sellable_variant_id,
      v_price,
      p_status,
      now()
    );
    v_existing_id := p_offer_id;
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_availabilities, '[]'::jsonb))
  LOOP
    INSERT INTO offer_availabilities (offer_id, scope, partner_location_id)
    VALUES (
      v_existing_id,
      v_item->>'scope',
      NULLIF(v_item->>'partnerLocationId', '')
    )
    ON CONFLICT ON CONSTRAINT offer_availabilities_offer_scope_location_key DO NOTHING;
  END LOOP;

  offer_id := v_existing_id;
  reused := v_reused;
  RETURN NEXT;
END;
$apply_plant_offer$;

ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_variant_product_fkey;
DROP INDEX IF EXISTS offers_variant_id_idx;
DROP INDEX IF EXISTS plant_variants_id_plant_id_key;
ALTER TABLE offers DROP COLUMN IF EXISTS variant_id;

ALTER TABLE plant_variants DROP CONSTRAINT IF EXISTS plant_variants_catalog_price_positive;
ALTER TABLE plant_variants DROP COLUMN IF EXISTS catalog_price;

ALTER TABLE plants DROP CONSTRAINT IF EXISTS plants_average_size_check;
ALTER TABLE plants DROP COLUMN IF EXISTS average_size;

DROP TABLE IF EXISTS pot_variants;

COMMIT;
