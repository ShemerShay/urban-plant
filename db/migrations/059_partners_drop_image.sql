-- Partner logos are removed from the product. Drop the unused column and
-- discard any stored image URLs. All other partner data is preserved.

ALTER TABLE partners
  DROP COLUMN IF EXISTS image;
