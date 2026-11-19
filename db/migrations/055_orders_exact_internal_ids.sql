-- Mark five reviewed historical test orders as internal.
-- Exact order_id equality only. Does not read names, emails, or product text.
-- Does not update payment_attempts.

UPDATE orders
SET is_internal = true
WHERE order_id IN (
  '220f4c61-47e0-47ad-9b37-8b5977bdf804'::uuid,
  '2e3e6e45-5b0d-4552-b6b9-a43ff6a50848'::uuid,
  '78caebdb-1897-4256-a214-9656d2e43f82'::uuid,
  '800e74ec-c3d6-4322-84d8-2c598f33ee09'::uuid,
  '2ed32aca-2fc8-4e28-8643-31124faa5b36'::uuid
);
