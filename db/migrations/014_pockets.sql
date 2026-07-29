-- Pockets as first-class entities under partner_locations.
-- Backfills pockets from legacy pos_spots.pocket / pocket_other.
-- Does NOT drop legacy pocket columns.

BEGIN;

CREATE TABLE IF NOT EXISTS pockets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_location_id text NOT NULL REFERENCES partner_locations (id),
  name                text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pockets_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS pockets_partner_name_key
  ON pockets (partner_location_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS pockets_partner_location_id_idx
  ON pockets (partner_location_id);

ALTER TABLE pos_spots
  ADD COLUMN IF NOT EXISTS pocket_id uuid REFERENCES pockets (id);

CREATE INDEX IF NOT EXISTS pos_spots_pocket_id_idx
  ON pos_spots (pocket_id)
  WHERE pocket_id IS NOT NULL;

-- Distinct legacy pocket values per partner → pocket rows
INSERT INTO pockets (partner_location_id, name)
SELECT
  s.partner_location_id,
  s.pocket_name
FROM (
  SELECT DISTINCT
    partner_location_id,
    CASE
      WHEN lower(trim(pocket)) = 'other' THEN
        COALESCE(NULLIF(trim(pocket_other), ''), 'Other')
      WHEN lower(trim(pocket)) = 'entrance' THEN 'Entrance'
      WHEN lower(trim(pocket)) = 'storefront_window' THEN 'Storefront Window'
      WHEN lower(trim(pocket)) = 'counter' THEN 'Counter'
      WHEN lower(trim(pocket)) = 'reception' THEN 'Reception'
      WHEN lower(trim(pocket)) = 'waiting_area' THEN 'Waiting Area'
      WHEN lower(trim(pocket)) = 'seating_area' THEN 'Seating Area'
      WHEN lower(trim(pocket)) = 'treatment_area' THEN 'Treatment Area'
      WHEN lower(trim(pocket)) = 'mirror_station' THEN 'Mirror Station'
      WHEN lower(trim(pocket)) = 'shelf_display' THEN 'Shelf Display'
      WHEN lower(trim(pocket)) = 'wall_side' THEN 'Wall Side'
      WHEN lower(trim(pocket)) = 'corner' THEN 'Corner'
      WHEN lower(trim(pocket)) = 'outdoor' THEN 'Outdoor'
      ELSE initcap(replace(trim(pocket), '_', ' '))
    END AS pocket_name
  FROM pos_spots
  WHERE pocket IS NOT NULL
    AND trim(pocket) <> ''
) s
WHERE NOT EXISTS (
  SELECT 1
  FROM pockets p
  WHERE p.partner_location_id = s.partner_location_id
    AND lower(trim(p.name)) = lower(trim(s.pocket_name))
);

-- Link spots to the pocket created for their partner + legacy value
UPDATE pos_spots ps
SET pocket_id = p.id
FROM pockets p
WHERE ps.pocket_id IS NULL
  AND ps.pocket IS NOT NULL
  AND trim(ps.pocket) <> ''
  AND p.partner_location_id = ps.partner_location_id
  AND lower(trim(p.name)) = lower(trim(
    CASE
      WHEN lower(trim(ps.pocket)) = 'other' THEN
        COALESCE(NULLIF(trim(ps.pocket_other), ''), 'Other')
      WHEN lower(trim(ps.pocket)) = 'entrance' THEN 'Entrance'
      WHEN lower(trim(ps.pocket)) = 'storefront_window' THEN 'Storefront Window'
      WHEN lower(trim(ps.pocket)) = 'counter' THEN 'Counter'
      WHEN lower(trim(ps.pocket)) = 'reception' THEN 'Reception'
      WHEN lower(trim(ps.pocket)) = 'waiting_area' THEN 'Waiting Area'
      WHEN lower(trim(ps.pocket)) = 'seating_area' THEN 'Seating Area'
      WHEN lower(trim(ps.pocket)) = 'treatment_area' THEN 'Treatment Area'
      WHEN lower(trim(ps.pocket)) = 'mirror_station' THEN 'Mirror Station'
      WHEN lower(trim(ps.pocket)) = 'shelf_display' THEN 'Shelf Display'
      WHEN lower(trim(ps.pocket)) = 'wall_side' THEN 'Wall Side'
      WHEN lower(trim(ps.pocket)) = 'corner' THEN 'Corner'
      WHEN lower(trim(ps.pocket)) = 'outdoor' THEN 'Outdoor'
      ELSE initcap(replace(trim(ps.pocket), '_', ' '))
    END
  ));

COMMIT;
