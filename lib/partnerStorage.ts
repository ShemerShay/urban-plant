import { sql } from "@/lib/db";
import { seedDefaultZeroCommissionTier } from "@/lib/partnerCommissionStorage";
import { toIsoString } from "@/lib/storageUtils";

/** Business/brand that owns one or more partner_locations. */
export interface Partner {
  id: string;
  name: string;
  createdAt?: string;
}

type PartnerRow = {
  id: string;
  name: string;
  created_at: string | Date;
};

function mapPartnerRow(row: PartnerRow): Partner {
  const createdAt = toIsoString(row.created_at);
  return {
    id: row.id,
    name: row.name,
    ...(createdAt ? { createdAt } : {}),
  };
}

export async function readPartners(): Promise<Partner[]> {
  const rows = await sql`
    SELECT id, name, created_at
    FROM partners
    ORDER BY name ASC
  `;
  return (rows as PartnerRow[]).map(mapPartnerRow);
}

export async function getPartnerById(id: string): Promise<Partner | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT id, name, created_at
    FROM partners
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as PartnerRow[])[0];
  return row ? mapPartnerRow(row) : undefined;
}

export async function createPartner(partner: {
  id: string;
  name: string;
}): Promise<Partner> {
  const rows = await sql`
    INSERT INTO partners (id, name)
    VALUES (${partner.id}, ${partner.name})
    RETURNING id, name, created_at
  `;
  const row = (rows as PartnerRow[])[0];
  if (!row) throw new Error("Could not create partner");
  const created = mapPartnerRow(row);
  await seedDefaultZeroCommissionTier(created.id);
  return created;
}

export async function updatePartner(
  id: string,
  patch: { name: string },
): Promise<Partner | null> {
  const rows = await sql`
    UPDATE partners
    SET name = ${patch.name}
    WHERE id = ${id.trim()}
    RETURNING id, name, created_at
  `;
  const row = (rows as PartnerRow[])[0];
  return row ? mapPartnerRow(row) : null;
}
