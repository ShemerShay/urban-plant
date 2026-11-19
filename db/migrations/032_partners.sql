-- Partners are the business/brand; partner_locations remain the physical branches.
-- Existing location ids are preserved so pockets, POS spots, orders, events, and
-- payment attempts keep their references.

CREATE TABLE IF NOT EXISTS partners (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  image       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partners_name_not_blank CHECK (length(trim(name)) > 0)
);

ALTER TABLE partner_locations
  ADD COLUMN IF NOT EXISTS partner_id text REFERENCES partners (id);

CREATE INDEX IF NOT EXISTS partner_locations_partner_id_idx
  ON partner_locations (partner_id);

-- The two Alon Shabo branches share one partner, linked by location id.
INSERT INTO partners (id, name)
SELECT 'alon-shabo', 'Alon Shabo'
WHERE EXISTS (
  SELECT 1 FROM partner_locations
  WHERE id IN ('0d11277b-9b47-45a5-ad80-22cf5c1ad2ef', 'ef33137e-fe13-4be3-84bb-1f5b80557815')
)
ON CONFLICT (id) DO NOTHING;

UPDATE partner_locations
SET partner_id = 'alon-shabo'
WHERE partner_id IS NULL
  AND id IN ('0d11277b-9b47-45a5-ad80-22cf5c1ad2ef', 'ef33137e-fe13-4be3-84bb-1f5b80557815');

-- Every other location becomes its own partner with the same id and name.
INSERT INTO partners (id, name, created_at)
SELECT id, name, created_at
FROM partner_locations
WHERE partner_id IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE partner_locations
SET partner_id = id
WHERE partner_id IS NULL;

ALTER TABLE partner_locations
  ALTER COLUMN partner_id SET NOT NULL;
