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
  createdAt?: string;
}

type PartnerLocationRow = {
  id: string;
  name: string;
  address: string;
  type: string;
  payments: unknown;
  created_at: string | Date;
};

function mapPartnerLocationRow(row: PartnerLocationRow): PartnerLocation {
  const createdAt = toIsoString(row.created_at);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    type: row.type,
    partnerType: row.type,
    payments: parsePartnerPayments(row.payments),
    ...(createdAt ? { createdAt } : {}),
  };
}

export async function readPartnerLocations(): Promise<PartnerLocation[]> {
  const rows = await sql`
    SELECT id, name, address, type, payments, created_at
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
    SELECT id, name, address, type, payments, created_at
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
    RETURNING id, name, address, type, payments, created_at
  `;
  const row = (rows as PartnerLocationRow[])[0];
  return row ? mapPartnerLocationRow(row) : null;
}
