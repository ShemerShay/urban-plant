import type { PlantProduct } from "@/lib/types";

export const CATALOG_CART_STORAGE_KEY = "up_catalog_cart";
export const CATALOG_CART_MAX_ITEMS = 50;

export type CatalogCartItem = {
  plantId: string;
  plantSizeId: string;
  sellableVariantId: string;
  offerId: string;
  potColorId: string | null;
  quantity: number;
};

/** Browser cart before the one-time v2 translation. Not a lasting selling model. */
export type CatalogCartLegacyItem = {
  plantId: string;
  plantVariantId: string;
  potVariantId: string | null;
  quantity: number;
};

export type CatalogCart =
  | { v: 2; items: CatalogCartItem[] }
  | { v: 1; items: CatalogCartLegacyItem[] };

export type CatalogCartResolvedLine = CatalogCartItem & {
  availableQuantity: number;
  name: string;
  nameHe?: string;
  image?: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
  unitPrice: number;
  currency: PlantProduct["currency"];
  potName?: string;
  potNameHe?: string;
  potSizeLabel?: string;
  potColor?: string;
  potColorHe?: string;
};

export const EMPTY_CATALOG_CART: CatalogCart = { v: 2, items: [] };

export function catalogCartItemKey(
  item: Pick<
    CatalogCartItem,
    "plantId" | "plantSizeId" | "sellableVariantId" | "offerId" | "potColorId"
  >,
): string {
  return `${item.plantId}::${item.plantSizeId}::${item.sellableVariantId}::${item.offerId}::${item.potColorId ?? ""}`;
}

export function catalogCartLineAmount(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

export function catalogCartTotalQuantity(cart: CatalogCart): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

function parseQuantity(value: unknown): number | null {
  if (!Number.isInteger(value) || (value as number) < 1) return null;
  return value as number;
}

function parseOptionalId(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

export function parseCatalogCartItem(raw: unknown): CatalogCartItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const plantId = typeof row.plantId === "string" ? row.plantId.trim() : "";
  const plantSizeId = typeof row.plantSizeId === "string" ? row.plantSizeId.trim() : "";
  const sellableVariantId =
    typeof row.sellableVariantId === "string" ? row.sellableVariantId.trim() : "";
  const offerId = typeof row.offerId === "string" ? row.offerId.trim() : "";
  const potColorId = parseOptionalId(row.potColorId);
  const quantity = parseQuantity(row.quantity);
  if (!plantId || !plantSizeId || !sellableVariantId || !offerId || potColorId === undefined) {
    return null;
  }
  if (quantity == null) return null;
  return { plantId, plantSizeId, sellableVariantId, offerId, potColorId, quantity };
}

export function parseCatalogCartLegacyItem(raw: unknown): CatalogCartLegacyItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const plantId = typeof row.plantId === "string" ? row.plantId.trim() : "";
  const plantVariantId = typeof row.plantVariantId === "string" ? row.plantVariantId.trim() : "";
  const potVariantId = parseOptionalId(row.potVariantId);
  const quantity = parseQuantity(row.quantity);
  if (!plantId || !plantVariantId || potVariantId === undefined || quantity == null) return null;
  return { plantId, plantVariantId, potVariantId, quantity };
}

function mergeCatalogCartItems(items: CatalogCartItem[]): CatalogCartItem[] {
  const merged = new Map<string, CatalogCartItem>();
  for (const item of items) {
    const key = catalogCartItemKey(item);
    const existing = merged.get(key);
    if (!existing) merged.set(key, { ...item });
    else merged.set(key, { ...existing, quantity: existing.quantity + item.quantity });
  }
  return [...merged.values()];
}

export function parseCatalogCart(raw: string | null | undefined): CatalogCart {
  if (raw == null || raw === "") return EMPTY_CATALOG_CART;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return EMPTY_CATALOG_CART;
    const record = data as Record<string, unknown>;
    if (!Array.isArray(record.items) || record.items.length > CATALOG_CART_MAX_ITEMS) {
      return EMPTY_CATALOG_CART;
    }
    if (record.items.length === 0) return EMPTY_CATALOG_CART;

    if (record.v === 2) {
      const items: CatalogCartItem[] = [];
      for (const row of record.items) {
        const item = parseCatalogCartItem(row);
        if (!item) return EMPTY_CATALOG_CART;
        items.push(item);
      }
      const merged = mergeCatalogCartItems(items);
      return merged.length === 0 ? EMPTY_CATALOG_CART : { v: 2, items: merged };
    }

    if (record.v === 1) {
      const items: CatalogCartLegacyItem[] = [];
      for (const row of record.items) {
        const item = parseCatalogCartLegacyItem(row);
        if (!item) return EMPTY_CATALOG_CART;
        items.push(item);
      }
      return items.length === 0 ? EMPTY_CATALOG_CART : { v: 1, items };
    }

    return EMPTY_CATALOG_CART;
  } catch {
    return EMPTY_CATALOG_CART;
  }
}

export type CatalogCartRequest =
  | { v: 2; items: CatalogCartItem[] }
  | { v: 1; items: CatalogCartLegacyItem[] };

export function parseCatalogCartRequest(body: unknown): CatalogCartRequest | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const items = record.items;
  if (!Array.isArray(items) || items.length > CATALOG_CART_MAX_ITEMS) return null;
  if (record.v === 1) {
    const parsed: CatalogCartLegacyItem[] = [];
    for (const row of items) {
      const item = parseCatalogCartLegacyItem(row);
      if (!item) return null;
      parsed.push(item);
    }
    return { v: 1, items: parsed };
  }
  const parsed: CatalogCartItem[] = [];
  for (const row of items) {
    const item = parseCatalogCartItem(row);
    if (!item) return null;
    parsed.push(item);
  }
  return { v: 2, items: parsed };
}

export function catalogCartItemsEqual(a: CatalogCartItem[], b: CatalogCartItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      other != null &&
      item.plantId === other.plantId &&
      item.plantSizeId === other.plantSizeId &&
      item.sellableVariantId === other.sellableVariantId &&
      item.offerId === other.offerId &&
      item.potColorId === other.potColorId &&
      item.quantity === other.quantity
    );
  });
}

export function storedCatalogCartItems(
  lines: Array<
    Pick<
      CatalogCartItem,
      "plantId" | "plantSizeId" | "sellableVariantId" | "offerId" | "potColorId" | "quantity"
    >
  >,
): CatalogCartItem[] {
  return lines.map((line) => ({
    plantId: line.plantId,
    plantSizeId: line.plantSizeId,
    sellableVariantId: line.sellableVariantId,
    offerId: line.offerId,
    potColorId: line.potColorId,
    quantity: line.quantity,
  }));
}

export function addCatalogCartItem(
  cart: CatalogCart,
  input: Pick<
    CatalogCartItem,
    "plantId" | "plantSizeId" | "sellableVariantId" | "offerId" | "potColorId"
  >,
  stock: number,
): { cart: CatalogCart; added: boolean } {
  if (cart.v !== 2) return { cart, added: false };
  if (!Number.isInteger(stock) || stock <= 0) return { cart, added: false };
  const key = catalogCartItemKey(input);
  const items = cart.items.map((item) => ({ ...item }));
  const index = items.findIndex((item) => catalogCartItemKey(item) === key);
  if (index === -1) {
    items.push({ ...input, quantity: 1 });
    return { cart: { v: 2, items }, added: true };
  }
  const existing = items[index];
  if (!existing || existing.quantity >= stock) return { cart, added: false };
  items[index] = { ...existing, quantity: existing.quantity + 1 };
  return { cart: { v: 2, items }, added: true };
}

export function updateCatalogCartQuantity(
  cart: CatalogCart,
  input: Pick<
    CatalogCartItem,
    "plantId" | "plantSizeId" | "sellableVariantId" | "offerId" | "potColorId"
  >,
  quantity: number,
  stock: number,
): CatalogCart {
  if (cart.v !== 2) return cart;
  const key = catalogCartItemKey(input);
  if (!Number.isInteger(stock) || stock <= 0) return removeCatalogCartItem(cart, input);
  if (!Number.isInteger(quantity)) return cart;
  const nextQty = Math.min(Math.max(1, quantity), stock);
  return {
    v: 2,
    items: cart.items.map((item) =>
      catalogCartItemKey(item) === key ? { ...item, quantity: nextQty } : item,
    ),
  };
}

/** Remove only the purchased quantities. Extra quantity added later stays in the Cart. */
export function subtractPurchasedCatalogItems(
  cart: CatalogCart,
  purchased: CatalogCartItem[],
): CatalogCart {
  if (cart.v !== 2) return cart;
  const items = cart.items.map((item) => ({ ...item }));
  for (const bought of purchased) {
    if (!Number.isInteger(bought.quantity) || bought.quantity < 1) continue;
    const key = catalogCartItemKey(bought);
    const index = items.findIndex((item) => catalogCartItemKey(item) === key);
    const current = index >= 0 ? items[index] : undefined;
    if (!current) continue;
    const nextQty = current.quantity - bought.quantity;
    if (nextQty < 1) items.splice(index, 1);
    else items[index] = { ...current, quantity: nextQty };
  }
  return items.length === 0 ? EMPTY_CATALOG_CART : { v: 2, items };
}

export function removeCatalogCartItem(
  cart: CatalogCart,
  input: Pick<
    CatalogCartItem,
    "plantId" | "plantSizeId" | "sellableVariantId" | "offerId" | "potColorId"
  >,
): CatalogCart {
  if (cart.v !== 2) return cart;
  const key = catalogCartItemKey(input);
  const items = cart.items.filter((item) => catalogCartItemKey(item) !== key);
  return items.length === 0 ? EMPTY_CATALOG_CART : { v: 2, items };
}
