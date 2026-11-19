/**
 * Slim Admin Orders list reads (filtered SELECT + DISTINCT filter options).
 * Does not replace {@link readOrders} — payment/Cardcom/email callers stay on the full reader.
 */
import "server-only";

import type { OrdersFilterState } from "@/lib/adminOrdersFilterUtils";
import { sql } from "@/lib/db";
import { saleIdentityFromRow } from "@/lib/orderSaleIdentity";
import {
  type FulfillmentMethod,
  type OrderSnapshot,
  type PurchaseEmailStatus,
  type SavedOrder,
} from "@/lib/orderTypes";
import { normalizeLegacyOrderStatus } from "@/lib/ordersStorage";
import { parseNumeric, toIsoString } from "@/lib/storageUtils";

export type AdminOrderLocationOption = {
  id: string;
  name: string;
};

export type AdminOrderPlantOption = {
  id: string;
  name: string;
  nameHe: string | null;
};

export type AdminOrderFilterOptions = {
  hasAnyOrders: boolean;
  hasNoLocationOrder: boolean;
  locations: AdminOrderLocationOption[];
  plants: AdminOrderPlantOption[];
};

type AdminListOrderRow = {
  order_id: string;
  product_id: string;
  product_name: string;
  partner_location_id: string | null;
  partner_location_name: string | null;
  partner_location_address: string | null;
  price: string | number;
  full_name: string;
  customer_email: string | null;
  phone: string;
  address: string;
  apartment_or_notes: string;
  fulfillment_method: string;
  order_status: string;
  channel: string | null;
  cancelled_at: string | Date | null;
  cancellation_reason: string | null;
  delivered_at: string | Date | null;
  picked_up_at: string | Date | null;
  snapshot: unknown;
  created_at: string | Date;
  purchase_email_status?: string | null;
};

function isPurchaseEmailStatus(value: unknown): value is PurchaseEmailStatus {
  return (
    value === "pending" ||
    value === "processing" ||
    value === "sent" ||
    value === "failed" ||
    value === "skipped"
  );
}

/** List snapshot: only fields Admin card/export need (+ keys normalize requires). */
function normalizeAdminListSnapshot(value: unknown): OrderSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const productId = typeof o.productId === "string" ? o.productId.trim() : "";
  const productName = typeof o.productName === "string" ? o.productName.trim() : "";
  const offerId = typeof o.offerId === "string" ? o.offerId : "";
  const consumerPrice =
    typeof o.consumerPrice === "number" && Number.isFinite(o.consumerPrice)
      ? o.consumerPrice
      : typeof o.consumerPrice === "string" && o.consumerPrice.trim() !== ""
        ? Number(o.consumerPrice)
        : NaN;
  if (!productId || !productName || !Number.isFinite(consumerPrice)) return undefined;
  const fulfillmentType: FulfillmentMethod =
    o.fulfillmentType === "pickup" ? "pickup" : "delivery";

  return {
    productId,
    productName,
    offerId,
    consumerPrice,
    fulfillmentType,
    ...(typeof o.partnerLocationId === "string" && o.partnerLocationId.trim()
      ? { partnerLocationId: o.partnerLocationId.trim() }
      : {}),
    ...(typeof o.partnerLocationName === "string" && o.partnerLocationName.trim()
      ? { partnerLocationName: o.partnerLocationName.trim() }
      : {}),
    ...(typeof o.posSpotDescription === "string" && o.posSpotDescription.trim()
      ? { posSpotDescription: o.posSpotDescription.trim() }
      : {}),
    ...(typeof o.spotSlug === "string" && o.spotSlug.trim()
      ? { spotSlug: o.spotSlug.trim() }
      : {}),
  };
}

function mapAdminListOrderRow(row: AdminListOrderRow): SavedOrder {
  const orderId = String(row.order_id);
  const fulfillmentMethod: FulfillmentMethod =
    row.fulfillment_method === "pickup" ? "pickup" : "delivery";
  const orderStatus = normalizeLegacyOrderStatus(row.order_status, "orderStatus");
  const snapshot = normalizeAdminListSnapshot(row.snapshot);

  const locationId =
    typeof row.partner_location_id === "string" && row.partner_location_id.trim()
      ? row.partner_location_id.trim()
      : null;
  let locationName =
    typeof row.partner_location_name === "string" ? row.partner_location_name : null;
  if (locationName !== null && locationName.trim() === "") locationName = null;
  let locationAddress =
    typeof row.partner_location_address === "string" ? row.partner_location_address : null;
  if (locationAddress !== null && locationAddress.trim() === "") locationAddress = null;

  const customerEmail =
    typeof row.customer_email === "string" && row.customer_email.trim()
      ? row.customer_email.trim()
      : undefined;
  const identity = saleIdentityFromRow(row);

  return {
    id: orderId,
    orderId,
    plantId: row.product_id,
    plantName: row.product_name,
    locationId,
    locationName,
    locationAddress,
    price: parseNumeric(row.price),
    fullName: row.full_name,
    ...(customerEmail ? { customerEmail } : {}),
    phone: row.phone ?? "",
    address: row.address ?? "",
    apartmentOrNotes: row.apartment_or_notes ?? "",
    fulfillmentMethod,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    orderStatus,
    ...(identity.channel ? { channel: identity.channel } : {}),
    partnerId: identity.partnerId,
    commissionRate: null,
    ...(toIsoString(row.cancelled_at) ? { cancelledAt: toIsoString(row.cancelled_at) } : {}),
    ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
    ...(snapshot ? { snapshot } : {}),
    ...(toIsoString(row.delivered_at) ? { deliveredAt: toIsoString(row.delivered_at) } : {}),
    ...(toIsoString(row.picked_up_at) ? { pickedUpAt: toIsoString(row.picked_up_at) } : {}),
    ...(isPurchaseEmailStatus(row.purchase_email_status)
      ? { purchaseEmailStatus: row.purchase_email_status }
      : {}),
  };
}

/**
 * Slim Admin list with URL filters applied in SQL.
 * Semantics match {@link filterOrders} (UTC dates, __none__, catalog plant via order_items).
 */
export async function readAdminOrdersList(filters: OrdersFilterState): Promise<SavedOrder[]> {
  const statusList = filters.statuses.length > 0 ? filters.statuses : null;
  const channelAll = filters.channel === "all";
  const channelCatalog = filters.channel === "catalog";
  const channelPartner = filters.channel === "partner";
  const locationAll = filters.location === "all";
  const locationNone = filters.location === "__none__";
  const locationId = !locationAll && !locationNone ? filters.location : null;
  const dateFrom = filters.dateFrom ?? null;
  const dateTo = filters.dateTo ?? null;
  const plantAll = filters.plant === "all";
  const plantId = plantAll ? null : filters.plant;

  const rows = await sql`
    SELECT
      order_id,
      product_id,
      product_name,
      partner_location_id,
      partner_location_name,
      partner_location_address,
      price,
      full_name,
      customer_email,
      phone,
      address,
      apartment_or_notes,
      fulfillment_method,
      order_status,
      channel,
      cancelled_at,
      cancellation_reason,
      delivered_at,
      picked_up_at,
      created_at,
      purchase_email_status,
      jsonb_strip_nulls(
        jsonb_build_object(
          'productId', snapshot->>'productId',
          'productName', snapshot->>'productName',
          'offerId', snapshot->>'offerId',
          'consumerPrice', snapshot->'consumerPrice',
          'fulfillmentType', snapshot->>'fulfillmentType',
          'partnerLocationId', snapshot->>'partnerLocationId',
          'partnerLocationName', snapshot->>'partnerLocationName',
          'posSpotDescription', snapshot->>'posSpotDescription',
          'spotSlug', snapshot->>'spotSlug'
        )
      ) AS snapshot
    FROM orders
    WHERE
      (${statusList}::text[] IS NULL OR order_status = ANY(${statusList}::text[]))
      AND (
        ${channelAll}::boolean
        OR (${channelCatalog}::boolean AND channel = 'catalog')
        OR (
          ${channelPartner}::boolean
          AND COALESCE(channel, 'partner') <> 'catalog'
        )
      )
      AND (
        ${locationAll}::boolean
        OR (
          ${locationNone}::boolean
          AND COALESCE(
            NULLIF(BTRIM(snapshot->>'partnerLocationId'), ''),
            partner_location_id
          ) IS NULL
        )
        OR (
          ${locationId}::text IS NOT NULL
          AND COALESCE(
            NULLIF(BTRIM(snapshot->>'partnerLocationId'), ''),
            partner_location_id
          ) = ${locationId}
        )
      )
      AND (
        ${dateFrom}::date IS NULL
        OR (created_at AT TIME ZONE 'UTC')::date >= ${dateFrom}::date
      )
      AND (
        ${dateTo}::date IS NULL
        OR (created_at AT TIME ZONE 'UTC')::date <= ${dateTo}::date
      )
      AND (
        ${plantAll}::boolean
        OR (
          channel = 'catalog'
          AND (
            EXISTS (
              SELECT 1
              FROM order_items oi
              WHERE oi.order_id = orders.order_id
                AND oi.plant_id = ${plantId}
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM order_items oi WHERE oi.order_id = orders.order_id
              )
              AND COALESCE(
                NULLIF(BTRIM(snapshot->>'productId'), ''),
                product_id
              ) = ${plantId}
            )
          )
        )
        OR (
          COALESCE(channel, 'partner') <> 'catalog'
          AND COALESCE(
            NULLIF(BTRIM(snapshot->>'productId'), ''),
            product_id
          ) = ${plantId}
        )
      )
    ORDER BY created_at DESC
  `;

  return (rows as AdminListOrderRow[]).map(mapAdminListOrderRow);
}

/** Complete location/plant filter options without loading full order rows. */
export async function readAdminOrderFilterOptions(): Promise<AdminOrderFilterOptions> {
  const [metaRows, locationRows, plantRows] = await Promise.all([
    sql`
      SELECT
        EXISTS (SELECT 1 FROM orders) AS has_any_orders,
        EXISTS (
          SELECT 1
          FROM orders
          WHERE COALESCE(
            NULLIF(BTRIM(snapshot->>'partnerLocationId'), ''),
            partner_location_id
          ) IS NULL
        ) AS has_no_location_order
    `,
    sql`
      SELECT DISTINCT
        loc_id AS id,
        loc_name AS name
      FROM (
        SELECT
          COALESCE(
            NULLIF(BTRIM(snapshot->>'partnerLocationId'), ''),
            partner_location_id
          ) AS loc_id,
          COALESCE(
            NULLIF(BTRIM(snapshot->>'partnerLocationName'), ''),
            NULLIF(BTRIM(partner_location_name), ''),
            COALESCE(
              NULLIF(BTRIM(snapshot->>'partnerLocationId'), ''),
              partner_location_id
            )
          ) AS loc_name
        FROM orders
      ) locations
      WHERE loc_id IS NOT NULL
      ORDER BY loc_name ASC
    `,
    sql`
      SELECT id, name, name_he
      FROM (
        SELECT DISTINCT ON (id)
          id,
          name,
          name_he
        FROM (
          SELECT
            COALESCE(
              NULLIF(BTRIM(snapshot->>'productId'), ''),
              product_id
            ) AS id,
            COALESCE(
              NULLIF(BTRIM(snapshot->>'productName'), ''),
              product_name
            ) AS name,
            NULL::text AS name_he
          FROM orders
          WHERE COALESCE(channel, 'partner') <> 'catalog'
             OR NOT EXISTS (
               SELECT 1 FROM order_items oi WHERE oi.order_id = orders.order_id
             )

          UNION ALL

          SELECT
            oi.plant_id AS id,
            oi.plant_name AS name,
            oi.plant_name_he AS name_he
          FROM order_items oi
          INNER JOIN orders o ON o.order_id = oi.order_id
          WHERE o.channel = 'catalog'
        ) plants_raw
        WHERE id IS NOT NULL AND BTRIM(id) <> ''
        ORDER BY id, name_he NULLS LAST, name ASC
      ) plants
      ORDER BY name ASC
    `,
  ]);

  const meta = (
    metaRows as { has_any_orders: boolean; has_no_location_order: boolean }[]
  )[0];

  return {
    hasAnyOrders: Boolean(meta?.has_any_orders),
    hasNoLocationOrder: Boolean(meta?.has_no_location_order),
    locations: (locationRows as { id: string; name: string }[]).map((row) => ({
      id: row.id,
      name: row.name?.trim() || row.id,
    })),
    plants: (plantRows as { id: string; name: string; name_he: string | null }[]).map(
      (row) => ({
        id: row.id,
        name: row.name?.trim() || row.id,
        nameHe:
          typeof row.name_he === "string" && row.name_he.trim() ? row.name_he.trim() : null,
      }),
    ),
  };
}
