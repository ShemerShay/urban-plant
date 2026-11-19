-- Partner/POS cutover: physical Pot Color on occupancy, Segment snapshots.
-- Does not invent Offers, Variants, availabilities, colors, or stock.
-- Does not drop offers.variant_id (Slice 7).
-- Does not add Sellable Variant / Pot Size / Pot Color to placement_cycles.

BEGIN;

ALTER TABLE pos_spots
  ADD COLUMN IF NOT EXISTS pot_color_id uuid;

ALTER TABLE pos_spots
  DROP CONSTRAINT IF EXISTS pos_spots_pot_color_id_fkey;

ALTER TABLE pos_spots
  ADD CONSTRAINT pos_spots_pot_color_id_fkey
  FOREIGN KEY (pot_color_id) REFERENCES pot_colors (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS pos_spots_pot_color_id_idx
  ON pos_spots (pot_color_id)
  WHERE pot_color_id IS NOT NULL;

ALTER TABLE pos_spots
  DROP CONSTRAINT IF EXISTS pos_spots_pot_color_requires_plant;

ALTER TABLE pos_spots
  ADD CONSTRAINT pos_spots_pot_color_requires_plant
  CHECK (pot_color_id IS NULL OR plant_variant_id IS NOT NULL);

ALTER TABLE placement_segments
  ADD COLUMN IF NOT EXISTS sellable_variant_id uuid;

ALTER TABLE placement_segments
  ADD COLUMN IF NOT EXISTS pot_color_id uuid;

ALTER TABLE placement_segments
  DROP CONSTRAINT IF EXISTS placement_segments_sellable_variant_id_fkey;

ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_sellable_variant_id_fkey
  FOREIGN KEY (sellable_variant_id) REFERENCES sellable_variants (id) ON DELETE RESTRICT;

ALTER TABLE placement_segments
  DROP CONSTRAINT IF EXISTS placement_segments_pot_color_id_fkey;

ALTER TABLE placement_segments
  ADD CONSTRAINT placement_segments_pot_color_id_fkey
  FOREIGN KEY (pot_color_id) REFERENCES pot_colors (id) ON DELETE RESTRICT;

UPDATE placement_segments s
SET sellable_variant_id = o.sellable_variant_id
FROM placement_cycles c
INNER JOIN pos_spots p ON p.id = c.pos_spot_id
LEFT JOIN offers o ON o.id = p.current_offer_id
WHERE s.placement_cycle_id = c.id
  AND s.ended_at IS NULL
  AND c.ended_at IS NULL
  AND s.sellable_variant_id IS NULL;

UPDATE placement_segments s
SET pot_color_id = p.pot_color_id
FROM placement_cycles c
INNER JOIN pos_spots p ON p.id = c.pos_spot_id
WHERE s.placement_cycle_id = c.id
  AND s.ended_at IS NULL
  AND c.ended_at IS NULL
  AND s.pot_color_id IS NULL
  AND p.pot_color_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_pos_occupancy_offer_color()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $pos_occupancy_color$
DECLARE
  v_sellable uuid;
  v_plant_size uuid;
  v_pot_size uuid;
  v_color_size uuid;
BEGIN
  IF NEW.plant_variant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT o.sellable_variant_id
    INTO v_sellable
  FROM offers o
  WHERE o.id = NEW.current_offer_id;

  IF v_sellable IS NULL THEN
    IF NEW.pot_color_id IS NOT NULL THEN
      RAISE EXCEPTION 'legacy occupancy cannot store a pot color'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT sv.plant_variant_id, sv.pot_size_id
    INTO v_plant_size, v_pot_size
  FROM sellable_variants sv
  WHERE sv.id = v_sellable;

  IF NEW.plant_variant_id IS DISTINCT FROM v_plant_size THEN
    RAISE EXCEPTION 'plant size must match the offer sellable variant'
      USING ERRCODE = '23514';
  END IF;

  IF v_pot_size IS NULL THEN
    IF NEW.pot_color_id IS NOT NULL THEN
      RAISE EXCEPTION 'no-pot occupancy cannot store a pot color'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.pot_color_id IS NULL THEN
    RAISE EXCEPTION 'pot-bearing occupancy requires a pot color'
      USING ERRCODE = '23514';
  END IF;

  SELECT c.pot_size_id
    INTO v_color_size
  FROM pot_colors c
  WHERE c.id = NEW.pot_color_id;

  IF v_color_size IS DISTINCT FROM v_pot_size THEN
    RAISE EXCEPTION 'pot color must belong to the offer pot size'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$pos_occupancy_color$;

DROP TRIGGER IF EXISTS pos_spots_occupancy_offer_color ON pos_spots;
CREATE TRIGGER pos_spots_occupancy_offer_color
  BEFORE INSERT OR UPDATE ON pos_spots
  FOR EACH ROW
  EXECUTE FUNCTION enforce_pos_occupancy_offer_color();

COMMIT;
