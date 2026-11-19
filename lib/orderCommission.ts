import { sql } from "@/lib/db";

export const COMMISSION_TIME_ZONE = "Asia/Jerusalem";

export type CommissionTier = {
  id: string;
  partnerId: string;
  minUnits: number;
  maxUnits: number | null;
  commissionRate: number;
};

export function jerusalemMonthKey(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: COMMISSION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) {
    throw new Error("Could not resolve Jerusalem calendar month");
  }
  return `${year}-${month}`;
}

export function isOpenCommissionMonth(orderCreatedAt: Date, now = new Date()): boolean {
  return jerusalemMonthKey(orderCreatedAt) === jerusalemMonthKey(now);
}

export function parseOptionalCommissionRate(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function rateFromTierRows(
  tiers: Pick<CommissionTier, "minUnits" | "maxUnits" | "commissionRate">[],
  plantCount: number,
): number | null {
  const match = tiers.find((tier) => {
    if (plantCount < tier.minUnits) return false;
    if (tier.maxUnits == null) return true;
    return plantCount <= tier.maxUnits;
  });
  return match ? match.commissionRate : null;
}

export async function productIsFlower(productId: string): Promise<boolean> {
  const trimmed = productId.trim();
  if (!trimmed) return false;
  const rows = await sql`
    SELECT inventory_type
    FROM plants
    WHERE id = ${trimmed}
    LIMIT 1
  `;
  const row = (rows as { inventory_type?: string | null }[])[0];
  return row?.inventory_type === "flowers";
}

export async function partnerHasOpenMonthPlantOrders(partnerId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1
    FROM orders o
    LEFT JOIN plants p ON p.id = o.product_id
    WHERE o.partner_id = ${partnerId}
      AND o.channel = 'partner'
      AND o.order_status <> 'cancelled'
      AND COALESCE(p.inventory_type, 'plants') = 'plants'
      AND date_trunc('month', timezone('Asia/Jerusalem', o.created_at))
        = date_trunc('month', timezone('Asia/Jerusalem', now()))
    LIMIT 1
  `;
  return (rows as unknown[]).length > 0;
}

/**
 * Assign the current Jerusalem month's plant rate to every non-cancelled
 * Partner plant order in that open month. Closed months are never updated.
 */
export async function syncOpenMonthPlantCommission(partnerId: string): Promise<number | null> {
  const trimmed = partnerId.trim();
  if (!trimmed) return null;

  const countRows = await sql`
    SELECT COUNT(*)::int AS n
    FROM orders o
    LEFT JOIN plants p ON p.id = o.product_id
    WHERE o.partner_id = ${trimmed}
      AND o.channel = 'partner'
      AND o.order_status <> 'cancelled'
      AND COALESCE(p.inventory_type, 'plants') = 'plants'
      AND date_trunc('month', timezone('Asia/Jerusalem', o.created_at))
        = date_trunc('month', timezone('Asia/Jerusalem', now()))
  `;
  const plantCount = Number((countRows as { n: string | number }[])[0]?.n ?? 0);
  if (!Number.isFinite(plantCount) || plantCount < 1) return null;

  const tierRows = await sql`
    SELECT min_units, max_units, commission_rate
    FROM partner_commission_tiers
    WHERE partner_id = ${trimmed}
    ORDER BY min_units ASC
  `;
  const rate = rateFromTierRows(
    (tierRows as { min_units: string | number; max_units: string | number | null; commission_rate: string | number }[]).map(
      (row) => ({
        minUnits: Number(row.min_units),
        maxUnits: row.max_units == null ? null : Number(row.max_units),
        commissionRate: Number(row.commission_rate),
      }),
    ),
    plantCount,
  );
  if (rate == null) return null;

  await sql`
    UPDATE orders o
    SET commission_rate = ${rate}
    FROM (
      SELECT o2.order_id
      FROM orders o2
      LEFT JOIN plants p ON p.id = o2.product_id
      WHERE o2.partner_id = ${trimmed}
        AND o2.channel = 'partner'
        AND o2.order_status <> 'cancelled'
        AND COALESCE(p.inventory_type, 'plants') = 'plants'
        AND date_trunc('month', timezone('Asia/Jerusalem', o2.created_at))
          = date_trunc('month', timezone('Asia/Jerusalem', now()))
    ) month_plants
    WHERE o.order_id = month_plants.order_id
      AND date_trunc('month', timezone('Asia/Jerusalem', o.created_at))
        = date_trunc('month', timezone('Asia/Jerusalem', now()))
  `;
  return rate;
}

export async function assignCommissionAfterPartnerOrderWrite(input: {
  channel: "partner" | "catalog";
  partnerId: string | null;
  productId: string;
  createdAt: Date;
}): Promise<void> {
  if (input.channel !== "partner" || !input.partnerId?.trim()) return;
  if (await productIsFlower(input.productId)) return;
  if (!isOpenCommissionMonth(input.createdAt)) return;
  await syncOpenMonthPlantCommission(input.partnerId);
}
