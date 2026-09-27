import { getPartnerLocationById } from "@/lib/partnerLocationStorage";

export type OrderChannel = "partner" | "catalog";

export function isOrderChannel(value: unknown): value is OrderChannel {
  return value === "partner" || value === "catalog";
}

export function saleIdentityFromRow(row: {
  channel?: unknown;
  partner_id?: unknown;
}): { channel?: OrderChannel; partnerId: string | null } {
  return {
    channel: isOrderChannel(row.channel) ? row.channel : undefined,
    partnerId:
      typeof row.partner_id === "string" && row.partner_id.trim()
        ? row.partner_id.trim()
        : null,
  };
}

export async function partnerSaleIdentityFromLocationId(
  locationId: string | null | undefined,
): Promise<{ channel: "partner"; partnerId: string } | null> {
  if (typeof locationId !== "string" || !locationId.trim()) return null;
  const location = await getPartnerLocationById(locationId.trim());
  const partnerId = location?.partnerId?.trim();
  if (!partnerId) return null;
  return { channel: "partner", partnerId };
}

/** Persistable sale identity. Catalog is explicit only; otherwise resolve the Partner. */
export async function resolveOrderSaleIdentity(order: {
  channel?: OrderChannel;
  partnerId?: string | null;
  locationId?: string | null;
}): Promise<{ channel: OrderChannel; partnerId: string | null }> {
  if (order.channel === "catalog") {
    if (typeof order.partnerId === "string" && order.partnerId.trim()) {
      throw new Error("Catalog sale cannot have a Partner id");
    }
    return { channel: "catalog", partnerId: null };
  }

  const explicit = typeof order.partnerId === "string" ? order.partnerId.trim() : "";
  if (explicit) {
    return { channel: "partner", partnerId: explicit };
  }

  const fromLocation = await partnerSaleIdentityFromLocationId(order.locationId);
  if (!fromLocation) {
    throw new Error("Partner sale requires partner_id from the order location");
  }
  return fromLocation;
}
