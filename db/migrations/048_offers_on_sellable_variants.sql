-- Plant Offers may point at one Sellable Variant and zero or more availability rows.
-- No inserts, no updates of existing rows, and no backfill.
-- offers.variant_id stays the legacy Plant Size column until Slice 7.

BEGIN;

ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS sellable_variant_id uuid REFERENCES sellable_variants (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS offers_sellable_variant_id_idx
  ON offers (sellable_variant_id)
  WHERE sellable_variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS offers_sellable_variant_consumer_price_key
  ON offers (sellable_variant_id, consumer_price)
  WHERE sellable_variant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS offer_availabilities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id             text NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  scope                text NOT NULL,
  partner_location_id  text NULL REFERENCES partner_locations (id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_availabilities_scope_check
    CHECK (scope IN ('catalog', 'partner_location')),
  CONSTRAINT offer_availabilities_scope_location_check
    CHECK (
      (scope = 'catalog' AND partner_location_id IS NULL)
      OR (scope = 'partner_location' AND partner_location_id IS NOT NULL)
    ),
  CONSTRAINT offer_availabilities_offer_scope_location_key
    UNIQUE NULLS NOT DISTINCT (offer_id, scope, partner_location_id)
);

CREATE INDEX IF NOT EXISTS offer_availabilities_partner_location_id_idx
  ON offer_availabilities (partner_location_id)
  WHERE partner_location_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_offer_sellable_variant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $offer_integrity$
DECLARE
  v_plant_id text;
  v_inventory text;
  v_offer_inventory text;
  v_variant_id uuid;
  v_status text;
  v_catalog_count integer;
BEGIN
  IF TG_TABLE_NAME = 'offers' THEN
    IF NEW.sellable_variant_id IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM 1
    FROM sellable_variants
    WHERE id = NEW.sellable_variant_id
    FOR UPDATE;

    SELECT inventory_type
      INTO v_offer_inventory
    FROM plants
    WHERE id = NEW.product_id;

    IF v_offer_inventory = 'flowers' THEN
      RAISE EXCEPTION 'flower offers cannot have a sellable variant'
        USING ERRCODE = '23514';
    END IF;

    SELECT pv.plant_id, p.inventory_type
      INTO v_plant_id, v_inventory
    FROM sellable_variants sv
    INNER JOIN plant_variants pv ON pv.id = sv.plant_variant_id
    INNER JOIN plants p ON p.id = pv.plant_id
    WHERE sv.id = NEW.sellable_variant_id;

    IF v_plant_id IS NULL THEN
      RAISE EXCEPTION 'sellable variant not found'
        USING ERRCODE = '23503';
    END IF;

    IF v_inventory = 'flowers' THEN
      RAISE EXCEPTION 'flower offers cannot have a sellable variant'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.product_id IS DISTINCT FROM v_plant_id THEN
      RAISE EXCEPTION 'offer product_id must match the sellable variant plant'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.status = 'active' AND EXISTS (
      SELECT 1
      FROM offer_availabilities
      WHERE offer_id = NEW.id
        AND scope = 'catalog'
    ) THEN
      SELECT COUNT(*)::integer
        INTO v_catalog_count
      FROM offers o
      INNER JOIN offer_availabilities a
        ON a.offer_id = o.id
       AND a.scope = 'catalog'
      WHERE o.sellable_variant_id = NEW.sellable_variant_id
        AND o.status = 'active'
        AND o.id IS DISTINCT FROM NEW.id;

      IF v_catalog_count > 0 THEN
        RAISE EXCEPTION 'active catalog offer already exists for this sellable variant'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'offer_availabilities' THEN
    SELECT o.sellable_variant_id
      INTO v_variant_id
    FROM offers o
    WHERE o.id = NEW.offer_id;

    IF v_variant_id IS NULL THEN
      RAISE EXCEPTION 'availability requires a sellable variant'
        USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM sellable_variants
    WHERE id = v_variant_id
    FOR UPDATE;

    SELECT o.status
      INTO v_status
    FROM offers o
    WHERE o.id = NEW.offer_id;

    IF NEW.scope = 'catalog' AND v_status = 'active' THEN
      SELECT COUNT(*)::integer
        INTO v_catalog_count
      FROM offers o
      INNER JOIN offer_availabilities a
        ON a.offer_id = o.id
       AND a.scope = 'catalog'
      WHERE o.sellable_variant_id = v_variant_id
        AND o.status = 'active'
        AND o.id IS DISTINCT FROM NEW.offer_id;

      IF v_catalog_count > 0 THEN
        RAISE EXCEPTION 'active catalog offer already exists for this sellable variant'
          USING ERRCODE = '23505';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$offer_integrity$;

DROP TRIGGER IF EXISTS offers_sellable_variant_integrity ON offers;
CREATE TRIGGER offers_sellable_variant_integrity
  BEFORE INSERT OR UPDATE ON offers
  FOR EACH ROW
  EXECUTE FUNCTION enforce_offer_sellable_variant_integrity();

DROP TRIGGER IF EXISTS offer_availabilities_sellable_variant_integrity ON offer_availabilities;
CREATE TRIGGER offer_availabilities_sellable_variant_integrity
  BEFORE INSERT OR UPDATE ON offer_availabilities
  FOR EACH ROW
  EXECUTE FUNCTION enforce_offer_sellable_variant_integrity();

-- Locks the Sellable Variant, then re-reads stored Offers before insert or reuse.
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
      variant_id,
      sellable_variant_id,
      consumer_price,
      status,
      created_at
    ) VALUES (
      p_offer_id,
      v_plant_id,
      NULL,
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

COMMIT;
