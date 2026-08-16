import { sql } from "@/lib/db";
import { parsePartnerPayments, type PartnerPaymentRecord } from "@/lib/partnerPayment";
import { toIsoString } from "@/lib/storageUtils";

export interface PartnerLocation {
  id: string;
  name: string;
  address: string;
  type: string;
  /** @deprecated Use `type`; mirrored for callers not yet migrated off `partnerType`. */
  partnerType: string;
  payments: PartnerPaymentRecord[];
  /** When true, checkout for this partner's POS spots hides pickup. */
  pickupDisabled: boolean;
  createdAt?: string;
}

export type PartnerLocationRow = {
  id: string;
  name: string;
  address: string;
  type: string;
  payments: unknown;
  pickup_disabled: boolean;
  created_at: string | Date;
};

export function mapPartnerLocationRow(row: PartnerLocationRow): PartnerLocation {
  const createdAt = toIsoString(row.created_at);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    type: row.type,
    partnerType: row.type,
    payments: parsePartnerPayments(row.payments),
    pickupDisabled: Boolean(row.pickup_disabled),
    ...(createdAt ? { createdAt } : {}),
  };
}

export async function readPartnerLocations(): Promise<PartnerLocation[]> {
  const rows = await sql`
    SELECT id, name, address, type, payments, pickup_disabled, created_at
    FROM partner_locations
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
    SELECT id, name, address, type, payments, pickup_disabled, created_at
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
    RETURNING id, name, address, type, payments, pickup_disabled, created_at
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
    INSERT INTO partner_locations (id, name, address, type, payments, pickup_disabled, created_at)
    VALUES (
      ${partner.id},
      ${partner.name},
      ${partner.address},
      ${partner.type},
      ${paymentsJson}::jsonb,
      ${partner.pickupDisabled},
      ${partner.createdAt ?? new Date().toISOString()}::timestamptz
    )
    RETURNING id, name, address, type, payments, pickup_disabled, created_at
  `;
  const row = (rows as PartnerLocationRow[])[0];
  if (!row) {
    throw new Error("Could not create partner");
  }
  return mapPartnerLocationRow(row);
}

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
      pickup_disabled = ${partner.pickupDisabled}
    WHERE id = ${trimmedId}
    RETURNING id, name, address, type, payments, pickup_disabled, created_at
  `;
  const row = (rows as PartnerLocationRow[])[0];
  return row ? mapPartnerLocationRow(row) : null;
}
