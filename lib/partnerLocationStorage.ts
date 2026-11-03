import { sql } from "@/lib/db";
import { parsePartnerPayments, type PartnerPaymentRecord } from "@/lib/partnerPayment";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

export interface PartnerLocation {
  id: string;
  /** Owning partner (business/brand); a partner can have many locations. */
  partnerId: string;
  name: string;
  address: string;
  type: string;
  /** @deprecated Use `type`; mirrored for callers not yet migrated off `partnerType`. */
  partnerType: string;
  payments: PartnerPaymentRecord[];
  /** When true, checkout for this partner's POS spots hides pickup. */
  pickupDisabled: boolean;
  /** Manually maintained monthly revenue estimate; not an analytics-derived sales value. */
  monthlyRevenue: number;
  /** Manually maintained setup cost; not derived from placement analytics. */
  setupCost: number;
  /** One current editable note; visit checklist copy is fixed in the UI. */
  notes: string;
  createdAt?: string;
}

export type PartnerLocationRow = {
  id: string;
  partner_id: string;
  name: string;
  address: string;
  type: string;
  payments: unknown;
  pickup_disabled: boolean;
  monthly_revenue: string | number;
  setup_cost: string | number;
  notes: string | null;
  created_at: string | Date;
};

export function mapPartnerLocationRow(row: PartnerLocationRow): PartnerLocation {
  const createdAt = toIsoString(row.created_at);
  return {
    id: row.id,
    partnerId: row.partner_id,
    name: row.name,
    address: row.address,
    type: row.type,
    partnerType: row.type,
    payments: parsePartnerPayments(row.payments),
    pickupDisabled: Boolean(row.pickup_disabled),
    monthlyRevenue: parseNumeric(row.monthly_revenue),
    setupCost: parseNumeric(row.setup_cost),
    notes: typeof row.notes === "string" ? row.notes : "",
    ...(createdAt ? { createdAt } : {}),
  };
}

export async function readPartnerLocations(): Promise<PartnerLocation[]> {
  const rows = await sql`
    SELECT id, partner_id, name, address, type, payments, pickup_disabled, monthly_revenue, setup_cost, notes, created_at
    FROM partner_locations
    ORDER BY name ASC
  `;
  return (rows as PartnerLocationRow[]).map(mapPartnerLocationRow);
}

/** Locations owned by one Partner brand. */
export async function readPartnerLocationsByPartnerId(
  partnerId: string,
): Promise<PartnerLocation[]> {
  const trimmed = partnerId.trim();
  if (!trimmed) return [];
  const rows = await sql`
    SELECT id, partner_id, name, address, type, payments, pickup_disabled, monthly_revenue, setup_cost, notes, created_at
    FROM partner_locations
    WHERE partner_id = ${trimmed}
    ORDER BY name ASC
  `;
  return (rows as PartnerLocationRow[]).map(mapPartnerLocationRow);
}

export async function getPartnerLocationById(
  id: string,
): Promise<PartnerLocation | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT id, partner_id, name, address, type, payments, pickup_disabled, monthly_revenue, setup_cost, notes, created_at
    FROM partner_locations
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as PartnerLocationRow[])[0];
  return row ? mapPartnerLocationRow(row) : undefined;
}

/** Updates street address for a partner location (shared by all POS spots at that site). */
export async function updatePartnerLocationAddress(
  id: string,
  address: string,
): Promise<PartnerLocation | null> {
  const trimmedId = id.trim();
  const trimmedAddress = address.trim();
  if (!trimmedId || !trimmedAddress) return null;
  const rows = await sql`
    UPDATE partner_locations
    SET address = ${trimmedAddress}
    WHERE id = ${trimmedId}
    RETURNING id, partner_id, name, address, type, payments, pickup_disabled, monthly_revenue, setup_cost, notes, created_at
  `;
  const row = (rows as PartnerLocationRow[])[0];
  return row ? mapPartnerLocationRow(row) : null;
}

export async function createPartnerLocation(
  partner: PartnerLocation,
): Promise<PartnerLocation> {
  const existing = await getPartnerLocationById(partner.id);
  if (existing) {
    throw new Error(`Partner with id "${partner.id}" already exists`);
  }

  const paymentsJson = JSON.stringify(partner.payments);

  const rows = await sql`
    INSERT INTO partner_locations (
      id, partner_id, name, address, type, payments, pickup_disabled, monthly_revenue, setup_cost, notes, created_at
    )
    VALUES (
      ${partner.id},
      ${partner.partnerId},
      ${partner.name},
      ${partner.address},
      ${partner.type},
      ${paymentsJson}::jsonb,
      ${partner.pickupDisabled},
      ${partner.monthlyRevenue},
      ${partner.setupCost},
      ${partner.notes},
      ${partner.createdAt ?? new Date().toISOString()}::timestamptz
    )
    RETURNING id, partner_id, name, address, type, payments, pickup_disabled, monthly_revenue, setup_cost, notes, created_at
  `;
  const row = (rows as PartnerLocationRow[])[0];
  if (!row) {
    throw new Error("Could not create partner");
  }
  return mapPartnerLocationRow(row);
}

/** Updates location fields; the owning partner is not changed here. */
export async function updatePartnerLocation(
  id: string,
  partner: PartnerLocation,
): Promise<PartnerLocation | null> {
  const trimmedId = id.trim();
  if (!trimmedId) return null;

  const paymentsJson = JSON.stringify(partner.payments);

  const rows = await sql`
    UPDATE partner_locations
    SET
      name = ${partner.name},
      address = ${partner.address},
      type = ${partner.type},
      payments = ${paymentsJson}::jsonb,
      pickup_disabled = ${partner.pickupDisabled},
      monthly_revenue = ${partner.monthlyRevenue},
      setup_cost = ${partner.setupCost},
      notes = ${partner.notes}
    WHERE id = ${trimmedId}
    RETURNING id, partner_id, name, address, type, payments, pickup_disabled, monthly_revenue, setup_cost, notes, created_at
  `;
  const row = (rows as PartnerLocationRow[])[0];
  return row ? mapPartnerLocationRow(row) : null;
}
