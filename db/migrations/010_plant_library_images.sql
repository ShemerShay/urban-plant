-- Plant image library (replaces writable public/plant-library on serverless hosts)

BEGIN;

CREATE TABLE IF NOT EXISTS plant_library_images (
  filename     text PRIMARY KEY,
  mime_type    text NOT NULL,
  data         bytea NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plant_library_images_mime_check
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif'))
);

CREATE INDEX IF NOT EXISTS plant_library_images_uploaded_at_idx
  ON plant_library_images (uploaded_at DESC);

COMMIT;
