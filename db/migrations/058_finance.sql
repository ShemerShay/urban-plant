-- Finance ledger for expenses, non-order income, inventory purchases,
-- historical Cardcom settlements, and financial allocations.
-- Orders are not copied here.

CREATE TABLE IF NOT EXISTS finance_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL,
  amount          numeric(12, 2) NOT NULL,
  occurred_on     date NOT NULL,
  description     text NOT NULL,
  category        text,
  partner_id      text REFERENCES partners (id),
  payment_status  text NOT NULL,
  import_key      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_entries_kind_check
    CHECK (kind IN ('expense', 'other_income', 'inventory_purchase', 'historical_settlement')),
  CONSTRAINT finance_entries_amount_positive
    CHECK (amount > 0),
  CONSTRAINT finance_entries_description_not_blank
    CHECK (length(btrim(description)) > 0),
  CONSTRAINT finance_entries_category_check
    CHECK (
      category IS NULL
      OR category IN (
        'inventory',
        'setup_fixtures',
        'marketing_signage',
        'software_systems',
        'professional_services',
        'maintenance_tools',
        'travel',
        'other'
      )
    ),
  CONSTRAINT finance_entries_category_by_kind_check
    CHECK (
      (kind = 'expense' AND category IS NOT NULL)
      OR (kind <> 'expense' AND category IS NULL)
    ),
  CONSTRAINT finance_entries_payment_status_check
    CHECK (payment_status IN ('unpaid', 'paid')),
  CONSTRAINT finance_entries_settlement_paid_check
    CHECK (kind <> 'historical_settlement' OR payment_status = 'paid')
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_entries_import_key_key
  ON finance_entries (import_key)
  WHERE import_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_entries_occurred_on_idx
  ON finance_entries (occurred_on DESC);

CREATE INDEX IF NOT EXISTS finance_entries_partner_id_idx
  ON finance_entries (partner_id)
  WHERE partner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_inventory_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id   uuid NOT NULL REFERENCES finance_entries (id) ON DELETE RESTRICT,
  partner_id    text NOT NULL REFERENCES partners (id),
  amount        numeric(12, 2) NOT NULL,
  occurred_on   date NOT NULL,
  description   text NOT NULL,
  import_key    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_inventory_allocations_amount_positive
    CHECK (amount > 0),
  CONSTRAINT finance_inventory_allocations_description_not_blank
    CHECK (length(btrim(description)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS finance_inventory_allocations_import_key_key
  ON finance_inventory_allocations (import_key)
  WHERE import_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS finance_inventory_allocations_purchase_id_idx
  ON finance_inventory_allocations (purchase_id);

CREATE OR REPLACE FUNCTION enforce_finance_allocation_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_purchase uuid;
  v_kind text;
  v_purchase_amount numeric;
  v_allocated numeric;
BEGIN
  v_purchase := COALESCE(NEW.purchase_id, OLD.purchase_id);

  SELECT kind, amount
    INTO v_kind, v_purchase_amount
  FROM finance_entries
  WHERE id = v_purchase;

  IF v_kind IS DISTINCT FROM 'inventory_purchase' THEN
    RAISE EXCEPTION 'allocation purchase must be an inventory purchase'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0)
    INTO v_allocated
  FROM finance_inventory_allocations
  WHERE purchase_id = v_purchase;

  IF v_allocated > v_purchase_amount THEN
    RAISE EXCEPTION 'allocation exceeds purchase amount'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS finance_inventory_allocations_cap
  ON finance_inventory_allocations;

CREATE TRIGGER finance_inventory_allocations_cap
  AFTER INSERT OR UPDATE OR DELETE
  ON finance_inventory_allocations
  FOR EACH ROW
  EXECUTE FUNCTION enforce_finance_allocation_cap();
