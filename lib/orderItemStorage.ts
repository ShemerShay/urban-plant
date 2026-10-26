/**
 * Historical catalog order lines.
 * Reads and inserts snapshots. Does not look up live catalog prices or supplier cost.
 */

import "server-only";

import { sql } from "@/lib/db";
import {
  catalogLineTotal,
  PLANT_UNIT_COST_SOURCE,
  POT_UNIT_COST_SOURCE,
  type CatalogCurrency,
  type CatalogPaymentSnapshot,
  type CatalogPaymentSnapshotLine,
  type PlantUnitCostSource,
  type PotUnitCostSource,
} from "@/lib/catalogCheckoutSnapshot";
import { parseNumeric } from "@/lib/storageUtils";

export type OrderItem = {
  id: string;
  orderId: string;
  lineNo: number;
  plantId: string;
  plantVariantId: string;
  sellableVariantId: string | null;
  offerId: string | null;
  potSizeId: string | null;
  potColorId: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  currency: CatalogCurrency;
  plantName: string;
  plantNameHe: string | null;
  sizeLabel: string | null;
  potName: string | null;
  potSizeLabel: string | null;
  potColor: string | null;
  potColorHe: string | null;
  plantUnitCost: number | null;
  plantUnitCostSource: PlantUnitCostSource | null;
  potUnitCost: number | null;
  potUnitCostSource: PotUnitCostSource | null;
};

type OrderItemRow = {
  id: string;
  order_id: string;
  line_no: string | number;
  plant_id: string;
  plant_variant_id: string;
  sellable_variant_id: string | null;
  offer_id: string | null;
  pot_size_id: string | null;
  pot_color_id: string | null;
  quantity: string | number;
  unit_price: string | number;
  line_total: string | number;
  currency: string;
  plant_name: string;
  plant_name_he: string | null;
  size_label: string | null;
  pot_name: string | null;
  pot_size_label: string | null;
  pot_color: string | null;
  pot_color_he: string | null;
  plant_unit_cost: string | number | null;
  plant_unit_cost_source: string | null;
  pot_unit_cost: string | number | null;
  pot_unit_cost_source: string | null;
};

function moneyCents(value: number): number {
  return Math.round(value * 100);
}

function nullableCost(value: string | number | null): number | null {
  if (value == null) return null;
  return parseNumeric(value);
}

function mapOrderItemRow(row: OrderItemRow): OrderItem {
  const currency: CatalogCurrency =
    row.currency === "USD" || row.currency === "EUR" ? row.currency : "ILS";
  const plantUnitCost = nullableCost(row.plant_unit_cost);
  const potUnitCost = nullableCost(row.pot_unit_cost);
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    lineNo: parseNumeric(row.line_no),
    plantId: row.plant_id,
    plantVariantId: String(row.plant_variant_id),
    sellableVariantId: row.sellable_variant_id ? String(row.sellable_variant_id) : null,
    offerId: row.offer_id,
    potSizeId: row.pot_size_id ? String(row.pot_size_id) : null,
    potColorId: row.pot_color_id ? String(row.pot_color_id) : null,
    quantity: parseNumeric(row.quantity),
    unitPrice: parseNumeric(row.unit_price),
    lineTotal: parseNumeric(row.line_total),
    currency,
    plantName: row.plant_name,
    plantNameHe: row.plant_name_he,
    sizeLabel: row.size_label,
    potName: row.pot_name,
    potSizeLabel: row.pot_size_label,
    potColor: row.pot_color,
    potColorHe: row.pot_color_he,
    plantUnitCost,
    plantUnitCostSource:
      plantUnitCost != null && row.plant_unit_cost_source === PLANT_UNIT_COST_SOURCE
        ? PLANT_UNIT_COST_SOURCE
        : null,
    potUnitCost,
    potUnitCostSource:
      potUnitCost != null && row.pot_unit_cost_source === POT_UNIT_COST_SOURCE
        ? POT_UNIT_COST_SOURCE
        : null,
  };
}

const ORDER_ITEM_SQL = sql`
  id,
  order_id,
  line_no,
  plant_id,
  plant_variant_id,
  sellable_variant_id,
  offer_id,
  pot_size_id,
  pot_color_id,
  quantity,
  unit_price,
  line_total,
  currency,
  plant_name,
  plant_name_he,
  size_label,
  pot_name,
  pot_size_label,
  pot_color,
  pot_color_he,
  plant_unit_cost,
  plant_unit_cost_source,
  pot_unit_cost,
  pot_unit_cost_source
`;

export function orderItemsFromCatalogSnapshot(
  snapshot: CatalogPaymentSnapshot,
): CatalogPaymentSnapshotLine[] {
  return snapshot.lines.map((line) => ({ ...line }));
}

function assertInsertableLine(line: CatalogPaymentSnapshotLine): void {
  const expected = catalogLineTotal(line.unitPrice, line.quantity);
  if (moneyCents(expected) !== moneyCents(line.lineTotal)) {
    throw new Error("Order item line total does not match quantity and unit price");
  }
  if ((line.plantUnitCost != null) !== (line.plantUnitCostSource != null)) {
    throw new Error("Order item plant cost and cost source must be stored together");
  }
  if (line.plantUnitCostSource != null && line.plantUnitCostSource !== PLANT_UNIT_COST_SOURCE) {
    throw new Error("Order item plant cost source is not plants.supplier_price@sale");
  }
  if ((line.potUnitCost != null) !== (line.potUnitCostSource != null)) {
    throw new Error("Order item pot cost and cost source must be stored together");
  }
  if (line.potUnitCostSource != null && line.potUnitCostSource !== POT_UNIT_COST_SOURCE) {
    throw new Error("Order item pot cost source is not pot_sizes.supplier_price@sale");
  }
  if (!line.sellableVariantId || !line.offerId) {
    throw new Error("Order item requires an Offer and a Sellable Variant");
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
          sellable_variant_id,
          offer_id,
          pot_size_id,
          pot_color_id,
          quantity,
          unit_price,
          line_total,
          currency,
          plant_name,
          plant_name_he,
          size_label,
          pot_name,
          pot_size_label,
          pot_color,
          pot_color_he,
          plant_unit_cost,
          plant_unit_cost_source,
          pot_unit_cost,
          pot_unit_cost_source
        )
        VALUES (
          ${id}::uuid,
          ${line.lineNo},
          ${line.plantId},
          ${line.plantVariantId}::uuid,
          ${line.sellableVariantId}::uuid,
          ${line.offerId},
          ${line.potSizeId}::uuid,
          ${line.potColorId}::uuid,
          ${line.quantity},
          ${line.unitPrice},
          ${line.lineTotal},
          ${line.currency},
          ${line.plantName},
          ${line.plantNameHe},
          ${line.sizeLabel},
          ${line.potName},
          ${line.potSizeLabel},
          ${line.potColor},
          ${line.potColorHe},
          ${line.plantUnitCost},
          ${line.plantUnitCostSource},
          ${line.potUnitCost},
          ${line.potUnitCostSource}
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
