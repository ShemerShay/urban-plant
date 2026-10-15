/**
 * Historical catalog order lines.
 * Reads and inserts snapshots. Does not look up live catalog prices or supplier cost.
 */

import "server-only";

import { sql } from "@/lib/db";
import {
  catalogLineTotal,
  PLANT_UNIT_COST_SOURCE,
  type CatalogCurrency,
  type CatalogPaymentSnapshot,
  type CatalogPaymentSnapshotLine,
  type PlantUnitCostSource,
} from "@/lib/catalogCheckoutSnapshot";
import { parseNumeric } from "@/lib/storageUtils";

export type OrderItem = {
  id: string;
  orderId: string;
  lineNo: number;
  plantId: string;
  plantVariantId: string;
  potVariantId: string | null;
  quantity: number;
  plantUnitPrice: number;
  potUnitPrice: number | null;
  lineTotal: number;
  currency: CatalogCurrency;
  plantName: string;
  plantNameHe: string | null;
  sizeLabel: string | null;
  potName: string | null;
  potColor: string | null;
  plantUnitCost: number | null;
  plantUnitCostSource: PlantUnitCostSource | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  line_no: string | number;
  plant_id: string;
  plant_variant_id: string;
  pot_variant_id: string | null;
  quantity: string | number;
  plant_unit_price: string | number;
  pot_unit_price: string | number | null;
  line_total: string | number;
  currency: string;
  plant_name: string;
  plant_name_he: string | null;
  size_label: string | null;
  pot_name: string | null;
  pot_color: string | null;
  plant_unit_cost: string | number | null;
  plant_unit_cost_source: string | null;
};

function moneyCents(value: number): number {
  return Math.round(value * 100);
}

function mapOrderItemRow(row: OrderItemRow): OrderItem {
  const currency: CatalogCurrency =
    row.currency === "USD" || row.currency === "EUR" ? row.currency : "ILS";
  const plantUnitCost =
    row.plant_unit_cost == null ? null : parseNumeric(row.plant_unit_cost);
  const plantUnitCostSource =
    row.plant_unit_cost_source === PLANT_UNIT_COST_SOURCE ? PLANT_UNIT_COST_SOURCE : null;
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    lineNo: parseNumeric(row.line_no),
    plantId: row.plant_id,
    plantVariantId: String(row.plant_variant_id),
    potVariantId: row.pot_variant_id ? String(row.pot_variant_id) : null,
    quantity: parseNumeric(row.quantity),
    plantUnitPrice: parseNumeric(row.plant_unit_price),
    potUnitPrice: row.pot_unit_price == null ? null : parseNumeric(row.pot_unit_price),
    lineTotal: parseNumeric(row.line_total),
    currency,
    plantName: row.plant_name,
    plantNameHe: row.plant_name_he,
    sizeLabel: row.size_label,
    potName: row.pot_name,
    potColor: row.pot_color,
    plantUnitCost: plantUnitCost != null && plantUnitCost > 0 ? plantUnitCost : null,
    plantUnitCostSource,
  };
}

const ORDER_ITEM_SQL = sql`
  id,
  order_id,
  line_no,
  plant_id,
  plant_variant_id,
  pot_variant_id,
  quantity,
  plant_unit_price,
  pot_unit_price,
  line_total,
  currency,
  plant_name,
  plant_name_he,
  size_label,
  pot_name,
  pot_color,
  plant_unit_cost,
  plant_unit_cost_source
`;

export function orderItemsFromCatalogSnapshot(
  snapshot: CatalogPaymentSnapshot,
): CatalogPaymentSnapshotLine[] {
  return snapshot.lines.map((line) => ({
    lineNo: line.lineNo,
    plantId: line.plantId,
    plantVariantId: line.plantVariantId,
    potVariantId: line.potVariantId,
    quantity: line.quantity,
    plantUnitPrice: line.plantUnitPrice,
    potUnitPrice: line.potUnitPrice,
    lineTotal: line.lineTotal,
    currency: line.currency,
    plantName: line.plantName,
    plantNameHe: line.plantNameHe,
    sizeLabel: line.sizeLabel,
    potName: line.potName,
    potColor: line.potColor,
    plantUnitCost: line.plantUnitCost,
    plantUnitCostSource: line.plantUnitCostSource,
  }));
}

function assertInsertableLine(line: CatalogPaymentSnapshotLine): void {
  const expected = catalogLineTotal(line.plantUnitPrice, line.potUnitPrice, line.quantity);
  if (moneyCents(expected) !== moneyCents(line.lineTotal)) {
    throw new Error("Order item line total does not match quantity and unit prices");
  }
  const hasCost = line.plantUnitCost != null;
  const hasSource = line.plantUnitCostSource != null;
  if (hasCost !== hasSource) {
    throw new Error("Order item plant cost and cost source must be stored together");
  }
  if (line.plantUnitCostSource != null && line.plantUnitCostSource !== PLANT_UNIT_COST_SOURCE) {
    throw new Error("Order item plant cost source is not plants.supplier_price@sale");
  }
}

/** Insert historical lines for one order. Does not re-read supplier_price. */
export async function insertOrderItems(
  orderId: string,
  lines: CatalogPaymentSnapshotLine[],
): Promise<OrderItem[]> {
  const id = orderId.trim();
  if (!id) throw new Error("Order id is required");
  if (lines.length === 0) return [];

  const lineNos = new Set<number>();
  for (const line of lines) {
    if (!Number.isInteger(line.lineNo) || line.lineNo <= 0) {
      throw new Error("Order item line number must be a positive integer");
    }
    if (lineNos.has(line.lineNo)) throw new Error("Order item line numbers must be unique");
    lineNos.add(line.lineNo);
    assertInsertableLine(line);
  }

  const ordered = [...lines].sort((a, b) => a.lineNo - b.lineNo);
  const results = await sql.transaction(
    ordered.map(
      (line) => sql`
        INSERT INTO order_items (
          order_id,
          line_no,
          plant_id,
          plant_variant_id,
          pot_variant_id,
          quantity,
          plant_unit_price,
          pot_unit_price,
          line_total,
          currency,
          plant_name,
          plant_name_he,
          size_label,
          pot_name,
          pot_color,
          plant_unit_cost,
          plant_unit_cost_source
        )
        VALUES (
          ${id}::uuid,
          ${line.lineNo},
          ${line.plantId},
          ${line.plantVariantId}::uuid,
          ${line.potVariantId ?? null}::uuid,
          ${line.quantity},
          ${line.plantUnitPrice},
          ${line.potUnitPrice},
          ${line.lineTotal},
          ${line.currency},
          ${line.plantName},
          ${line.plantNameHe},
          ${line.sizeLabel},
          ${line.potName},
          ${line.potColor},
          ${line.plantUnitCost ?? null},
          ${line.plantUnitCostSource ?? null}
        )
        RETURNING ${ORDER_ITEM_SQL}
      `,
    ),
  );

  return (results as OrderItemRow[][]).flat().map(mapOrderItemRow);
}

export async function getOrderItemsByOrderId(orderId: string): Promise<OrderItem[]> {
  const id = orderId.trim();
  if (!id) return [];
  const rows = await sql`
    SELECT ${ORDER_ITEM_SQL}
    FROM order_items
    WHERE order_id = ${id}::uuid
    ORDER BY line_no ASC, id ASC
  `;
  return (rows as OrderItemRow[]).map(mapOrderItemRow);
}

export async function getOrderItemsByOrderIds(
  orderIds: string[],
): Promise<Map<string, OrderItem[]>> {
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
  const grouped = new Map<string, OrderItem[]>();
  for (const id of ids) grouped.set(id, []);
  if (ids.length === 0) return grouped;

  const rows = await sql`
    SELECT ${ORDER_ITEM_SQL}
    FROM order_items
    WHERE order_id = ANY(${ids}::uuid[])
    ORDER BY order_id ASC, line_no ASC, id ASC
  `;
  for (const item of (rows as OrderItemRow[]).map(mapOrderItemRow)) {
    const list = grouped.get(item.orderId);
    if (list) list.push(item);
    else grouped.set(item.orderId, [item]);
  }
  return grouped;
}
