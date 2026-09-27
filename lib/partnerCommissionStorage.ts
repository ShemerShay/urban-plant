import { randomUUID } from "node:crypto";

import { sql } from "@/lib/db";
import {
  partnerHasOpenMonthPlantOrders,
  type CommissionTier,
} from "@/lib/orderCommission";
import type { ParsedCommissionTier } from "@/lib/partnerCommissionValidation";

export class PartnerCommissionAgreementLockedError extends Error {
  constructor() {
    super(
      "Commission agreement changes take effect from the start of the next calendar month",
    );
    this.name = "PartnerCommissionAgreementLockedError";
  }
}

type TierRow = {
  id: string;
  partner_id: string;
  min_units: string | number;
  max_units: string | number | null;
  commission_rate: string | number;
};

function mapTierRow(row: TierRow): CommissionTier {
  return {
    id: row.id,
    partnerId: row.partner_id,
    minUnits: Number(row.min_units),
    maxUnits: row.max_units == null ? null : Number(row.max_units),
    commissionRate: Number(row.commission_rate),
  };
}

export async function readPartnerCommissionTiers(
  partnerId: string,
): Promise<CommissionTier[]> {
  const trimmed = partnerId.trim();
  if (!trimmed) return [];
  const rows = await sql`
    SELECT id, partner_id, min_units, max_units, commission_rate
    FROM partner_commission_tiers
    WHERE partner_id = ${trimmed}
    ORDER BY min_units ASC
  `;
  return (rows as TierRow[]).map(mapTierRow);
}

export async function seedDefaultZeroCommissionTier(partnerId: string): Promise<CommissionTier> {
  const trimmed = partnerId.trim();
  const id = `commission-zero-${trimmed}`;
  const rows = await sql`
    INSERT INTO partner_commission_tiers (id, partner_id, min_units, max_units, commission_rate)
    VALUES (${id}, ${trimmed}, 1, NULL, 0)
    ON CONFLICT (id) DO UPDATE SET
      min_units = EXCLUDED.min_units,
      max_units = EXCLUDED.max_units,
      commission_rate = EXCLUDED.commission_rate
    RETURNING id, partner_id, min_units, max_units, commission_rate
  `;
  const row = (rows as TierRow[])[0];
  if (!row) throw new Error("Could not seed default 0% commission tier");
  return mapTierRow(row);
}

export async function replacePartnerCommissionTiers(
  partnerId: string,
  tiers: ParsedCommissionTier[],
): Promise<CommissionTier[]> {
  const trimmed = partnerId.trim();
  if (!trimmed) throw new Error("Partner id is required");
  if (await partnerHasOpenMonthPlantOrders(trimmed)) {
    throw new PartnerCommissionAgreementLockedError();
  }

  const results = await sql.transaction([
    sql`
      DELETE FROM partner_commission_tiers
      WHERE partner_id = ${trimmed}
    `,
    ...tiers.map(
      (tier) => sql`
        INSERT INTO partner_commission_tiers (
          id, partner_id, min_units, max_units, commission_rate
        )
        VALUES (
          ${randomUUID()},
          ${trimmed},
          ${tier.minUnits},
          ${tier.maxUnits},
          ${tier.commissionRate}
        )
        RETURNING id, partner_id, min_units, max_units, commission_rate
      `,
    ),
  ]);

  const inserted: CommissionTier[] = [];
  for (const rows of results.slice(1)) {
    const row = (rows as TierRow[])[0];
    if (!row) throw new Error("Could not save commission tier");
    inserted.push(mapTierRow(row));
  }
  return inserted;
}
