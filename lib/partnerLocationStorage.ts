import { sql } from "@/lib/db";
import { toIsoString } from "@/lib/storageUtils";

export interface PartnerLocation {
  id: string;
  name: string;
  address: string;
  type: string;
  partnerType: string;
  createdAt?: string;
}

type PartnerLocationRow = {
  id: string;
  name: string;
  address: string;
  type: string;
  partner_type: string;
  created_at: string | Date;
};

function mapPartnerLocationRow(row: PartnerLocationRow): PartnerLocation {
  const createdAt = toIsoString(row.created_at);
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    type: row.type,
    partnerType: row.partner_type,
    ...(createdAt ? { createdAt } : {}),
  };
}

export async function readPartnerLocations(): Promise<PartnerLocation[]> {
  const rows = await sql`
    SELECT id, name, address, type, partner_type, created_at
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
    SELECT id, name, address, type, partner_type, created_at
    FROM partner_locations
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as PartnerLocationRow[])[0];
  return row ? mapPartnerLocationRow(row) : undefined;
}
