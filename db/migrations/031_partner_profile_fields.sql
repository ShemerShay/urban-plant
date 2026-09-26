-- Partner profile fields used by the admin partner page.
-- Analytics-derived financial values remain out of this table.

ALTER TABLE partner_locations
  ADD COLUMN IF NOT EXISTS monthly_revenue numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_cost numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '';

ALTER TABLE partner_locations
  DROP CONSTRAINT IF EXISTS partner_locations_monthly_revenue_non_negative;

ALTER TABLE partner_locations
  ADD CONSTRAINT partner_locations_monthly_revenue_non_negative
  CHECK (monthly_revenue >= 0);

ALTER TABLE partner_locations
  DROP CONSTRAINT IF EXISTS partner_locations_setup_cost_non_negative;

ALTER TABLE partner_locations
  ADD CONSTRAINT partner_locations_setup_cost_non_negative
  CHECK (setup_cost >= 0);
