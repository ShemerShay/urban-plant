-- Simplify plants model: new light values, x-large size, drop unused columns.

BEGIN;

ALTER TABLE plants DROP CONSTRAINT IF EXISTS plants_light_check;

UPDATE plants
SET light = 'Bright indirect light'
WHERE light = 'Indirect bright light';

UPDATE plants
SET light = 'Direct sun'
WHERE light = 'Full sun';

UPDATE plants
SET light = 'Medium light'
WHERE light NOT IN (
  'Low light',
  'Medium light',
  'Bright indirect light',
  'Direct sun'
);

ALTER TABLE plants
  ADD CONSTRAINT plants_light_check
  CHECK (light IN (
    'Low light',
    'Medium light',
    'Bright indirect light',
    'Direct sun'
  ));

ALTER TABLE plants DROP CONSTRAINT IF EXISTS plants_average_size_check;

ALTER TABLE plants
  ADD CONSTRAINT plants_average_size_check
  CHECK (
    average_size IS NULL
    OR average_size IN ('small', 'medium', 'large', 'x-large')
  );

ALTER TABLE plants DROP COLUMN IF EXISTS maintenance_conditions;
ALTER TABLE plants DROP COLUMN IF EXISTS commercial_copy;

COMMIT;
