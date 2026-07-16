-- partner_locations: optional flag to hide pickup on checkout for this partner's POS spots

ALTER TABLE partner_locations
  ADD COLUMN IF NOT EXISTS pickup_disabled boolean NOT NULL DEFAULT false;
