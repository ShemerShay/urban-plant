import { sql } from "@/lib/db";
import { toIsoString } from "@/lib/storageUtils";

/** Business/brand that owns one or more partner_locations. */
export interface Partner {
  id: string;
  name: string;
  /** Logo URL (usually an uploaded image-library URL). */
  image: string | null;
  createdAt?: string;
}

type PartnerRow = {
  id: string;
  name: string;
  image: string | null;
  created_at: string | Date;
};

function mapPartnerRow(row: PartnerRow): Partner {
  const createdAt = toIsoString(row.created_at);
  return {
    id: row.id,
    name: row.name,
    image: row.image?.trim() ? row.image : null,
    ...(createdAt ? { createdAt } : {}),
  };
}

export async function readPartners(): Promise<Partner[]> {
  const rows = await sql`
    SELECT id, name, image, created_at
    FROM partners
    ORDER BY name ASC
  `;
  return (rows as PartnerRow[]).map(mapPartnerRow);
}

export async function getPartnerById(id: string): Promise<Partner | undefined> {
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  const rows = await sql`
    SELECT id, name, image, created_at
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
  image: string | null;
}): Promise<Partner> {
  const rows = await sql`
    INSERT INTO partners (id, name, image)
    VALUES (${partner.id}, ${partner.name}, ${partner.image})
    RETURNING id, name, image, created_at
  `;
  const row = (rows as PartnerRow[])[0];
  if (!row) throw new Error("Could not create partner");
  return mapPartnerRow(row);
}

export async function updatePartner(
  id: string,
  patch: { name: string; image: string | null },
): Promise<Partner | null> {
  const rows = await sql`
    UPDATE partners
    SET name = ${patch.name}, image = ${patch.image}
    WHERE id = ${id.trim()}
    RETURNING id, name, image, created_at
  `;
  const row = (rows as PartnerRow[])[0];
  return row ? mapPartnerRow(row) : null;
}
