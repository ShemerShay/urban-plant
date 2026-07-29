-- Unassign POS spots from legacy "-" pockets, then remove those empty pockets.
-- Does not modify spot_slug, pos_number, or other POS spot identity fields.

BEGIN;

UPDATE pos_spots
SET pocket_id = NULL
WHERE pocket_id IN (
  SELECT id FROM pockets WHERE trim(name) = '-'
);

DELETE FROM pockets
WHERE trim(name) = '-'
  AND NOT EXISTS (
    SELECT 1 FROM pos_spots WHERE pocket_id = pockets.id
  );

COMMIT;
