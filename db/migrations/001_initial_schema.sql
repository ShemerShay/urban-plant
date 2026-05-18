-- Urban Plant — initial Postgres schema (Neon)
-- spot_slug / spotSlug only — no qrSlug columns or fields

BEGIN;

-- ---------------------------------------------------------------------------
-- partner_locations
-- ---------------------------------------------------------------------------
CREATE TABLE partner_locations (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  address         text NOT NULL,
  type            text NOT NULL,
  partner_type    text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- offers (product_id = soft reference to lib/mockPlants.ts catalog)
-- ---------------------------------------------------------------------------
CREATE TABLE offers (
  id              text PRIMARY KEY,
  product_id      text NOT NULL,
  consumer_price  numeric(10, 2) NOT NULL,
  supplier_price  numeric(10, 2),
  supplier_name   text,
  status          text NOT NULL,
  created_at      timestamptz NOT NULL,
  CONSTRAINT offers_status_check
    CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX offers_product_id_idx ON offers (product_id);
CREATE INDEX offers_status_idx ON offers (status) WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- pos_spots
-- ---------------------------------------------------------------------------
CREATE TABLE pos_spots (
  id                        text PRIMARY KEY,
  partner_location_id       text NOT NULL REFERENCES partner_locations (id),
  pos_number                text,
  spot_description          text NOT NULL,
  placement_notes           text,
  spot_slug                 text NOT NULL,
  current_offer_id          text NOT NULL REFERENCES offers (id),
  status                    text NOT NULL,
  placed_at                 timestamptz,
  latest_maintenance_status text,
  last_checked_at           timestamptz,
  last_watered_at           timestamptz,
  last_handled_at           timestamptz,
  last_handled_by           text,
  created_at                timestamptz NOT NULL,
  CONSTRAINT pos_spots_status_check
    CHECK (status IN ('available', 'sold', 'inactive')),
  CONSTRAINT pos_spots_maintenance_status_check
    CHECK (
      latest_maintenance_status IS NULL
      OR latest_maintenance_status IN ('checked', 'needs_watering', 'needs_treatment')
    )
);

CREATE UNIQUE INDEX pos_spots_spot_slug_key ON pos_spots (spot_slug);
CREATE INDEX pos_spots_partner_location_id_idx ON pos_spots (partner_location_id);
CREATE INDEX pos_spots_status_idx ON pos_spots (status);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  order_id                  uuid PRIMARY KEY,
  checkout_session_id       text,
  pos_spot_id               text REFERENCES pos_spots (id),
  offer_id                  text REFERENCES offers (id),
  product_id                text NOT NULL,
  product_name              text NOT NULL,
  partner_location_id       text,
  partner_location_name     text,
  partner_location_address  text,
  price                     numeric(10, 2) NOT NULL,
  full_name                 text NOT NULL,
  customer_email            text,
  phone                     text NOT NULL DEFAULT '',
  address                   text NOT NULL DEFAULT '',
  apartment_or_notes        text NOT NULL DEFAULT '',
  fulfillment_method        text NOT NULL,
  order_status              text NOT NULL,
  source                    text,
  cancelled_at              timestamptz,
  cancelled_by              text,
  cancellation_reason       text,
  delivered_at              timestamptz,
  picked_up_at              timestamptz,
  snapshot                  jsonb,
  created_at                timestamptz NOT NULL,
  CONSTRAINT orders_fulfillment_method_check
    CHECK (fulfillment_method IN ('delivery', 'pickup')),
  CONSTRAINT orders_order_status_check
    CHECK (order_status IN ('sold', 'picked_up', 'delivered', 'cancelled')),
  CONSTRAINT orders_source_check
    CHECK (source IS NULL OR source IN ('online', 'manual', 'admin'))
);

CREATE INDEX orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX orders_order_status_idx ON orders (order_status);
CREATE INDEX orders_pos_spot_id_idx ON orders (pos_spot_id) WHERE pos_spot_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- events (append-only activity log; soft references, no FKs)
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id                    uuid PRIMARY KEY,
  type                  text NOT NULL,
  pos_spot_id           text,
  offer_id              text,
  order_id              uuid,
  product_id            text,
  partner_location_id   text,
  created_at            timestamptz NOT NULL,
  created_by            text,
  data                  jsonb,
  CONSTRAINT events_type_check
    CHECK (type IN (
      'order_created',
      'order_cancelled',
      'manual_status_update',
      'plant_placed'
    ))
);

CREATE INDEX events_created_at_idx ON events (created_at DESC);
CREATE INDEX events_order_id_idx ON events (order_id) WHERE order_id IS NOT NULL;

COMMIT;
