/**
 * Activity log records for POS Spots and Orders (Neon Postgres).
 */

import { sql } from "@/lib/db";
import { toIsoString } from "@/lib/storageUtils";

import type { ActivityEvent, ActivityEventType } from "./eventTypes";

type EventRow = {
  id: string;
  type: string;
  pos_spot_id: string | null;
  offer_id: string | null;
  order_id: string | null;
  product_id: string | null;
  partner_location_id: string | null;
  created_at: string | Date;
  created_by: string | null;
  data: unknown;
};

function mapEventRow(row: EventRow): ActivityEvent {
  const type = row.type as ActivityEventType;
  const event: ActivityEvent = {
    id: String(row.id),
    type,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
  };
  if (row.pos_spot_id) event.posSpotId = row.pos_spot_id;
  if (row.offer_id) event.offerId = row.offer_id;
  if (row.order_id) event.orderId = String(row.order_id);
  if (row.product_id) event.productId = row.product_id;
  if (row.partner_location_id) event.partnerLocationId = row.partner_location_id;
  if (row.created_by) event.createdBy = row.created_by;
  if (row.data && typeof row.data === "object" && !Array.isArray(row.data)) {
    event.data = row.data as Record<string, unknown>;
  }
  return event;
}

export async function readEvents(): Promise<ActivityEvent[]> {
  const rows = await sql`
    SELECT
      id,
      type,
      pos_spot_id,
      offer_id,
      order_id,
      product_id,
      partner_location_id,
      created_at,
      created_by,
      data
    FROM events
    ORDER BY created_at ASC
  `;
  return (rows as EventRow[]).map(mapEventRow);
}

export async function saveEvents(events: ActivityEvent[]): Promise<void> {
  await sql`DELETE FROM events`;
  for (const event of events) {
    await insertEvent(event);
  }
}

async function insertEvent(event: ActivityEvent): Promise<void> {
  await sql`
    INSERT INTO events (
      id,
      type,
      pos_spot_id,
      offer_id,
      order_id,
      product_id,
      partner_location_id,
      created_at,
      created_by,
      data
    )
    VALUES (
      ${event.id}::uuid,
      ${event.type},
      ${event.posSpotId ?? null},
      ${event.offerId ?? null},
      ${event.orderId ?? null}::uuid,
      ${event.productId ?? null},
      ${event.partnerLocationId ?? null},
      ${event.createdAt}::timestamptz,
      ${event.createdBy ?? null},
      ${event.data ? JSON.stringify(event.data) : null}::jsonb
    )
  `;
}

export async function appendEvent(event: ActivityEvent): Promise<void> {
  await insertEvent(event);
}
