import type { PlantProduct } from "@/lib/types";

export const CATALOG_CART_STORAGE_KEY = "up_catalog_cart";
export const CATALOG_CART_MAX_ITEMS = 50;

export type CatalogCartItem = {
  plantId: string;
  plantVariantId: string;
  potVariantId: string | null;
  quantity: number;
};

export type CatalogCart = {
  v: 1;
  items: CatalogCartItem[];
};

export type CatalogCartResolvedLine = CatalogCartItem & {
  availableQuantity: number;
  name: string;
  nameHe?: string;
  image?: string;
  sizeLabel?: string;
  nurseryPotDiameterCm?: number;
  plantPrice: number;
  currency: PlantProduct["currency"];
  potName?: string;
  potNameHe?: string;
  potColor?: string;
  potColorHe?: string;
  potPrice?: number;
};

export const EMPTY_CATALOG_CART: CatalogCart = { v: 1, items: [] };

export function catalogCartItemKey(
  item: Pick<CatalogCartItem, "plantId" | "plantVariantId" | "potVariantId">,
): string {
  return `${item.plantId}::${item.plantVariantId}::${item.potVariantId ?? ""}`;
}

export function catalogCartLineAmount(
  plantPrice: number,
  potPrice: number | undefined,
  quantity: number,
): number {
  return (plantPrice + (potPrice ?? 0)) * quantity;
}

export function catalogCartTotalQuantity(cart: CatalogCart): number {
  return cart.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function parseCatalogCartItem(raw: unknown): CatalogCartItem | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const plantId = typeof row.plantId === "string" ? row.plantId.trim() : "";
  const plantVariantId = typeof row.plantVariantId === "string" ? row.plantVariantId.trim() : "";
  if (!plantId || !plantVariantId) return null;

  let potVariantId: string | null = null;
  if (row.potVariantId == null) {
    potVariantId = null;
  } else if (typeof row.potVariantId === "string") {
    const trimmed = row.potVariantId.trim();
    potVariantId = trimmed || null;
  } else {
    return null;
  }

  if (!Number.isInteger(row.quantity) || (row.quantity as number) < 1) return null;

  return {
    plantId,
    plantVariantId,
    potVariantId,
    quantity: row.quantity as number,
  };
}

function mergeCatalogCartItems(items: CatalogCartItem[]): CatalogCartItem[] {
  const merged = new Map<string, CatalogCartItem>();
  for (const item of items) {
    const key = catalogCartItemKey(item);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item });
    } else {
      merged.set(key, { ...existing, quantity: existing.quantity + item.quantity });
    }
  }
  return [...merged.values()];
}

export function parseCatalogCart(raw: string | null | undefined): CatalogCart {
  if (raw == null || raw === "") return EMPTY_CATALOG_CART;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return EMPTY_CATALOG_CART;
    const record = data as Record<string, unknown>;
    if (record.v !== 1 || !Array.isArray(record.items)) return EMPTY_CATALOG_CART;
    if (record.items.length > CATALOG_CART_MAX_ITEMS) return EMPTY_CATALOG_CART;
    const items: CatalogCartItem[] = [];
    for (const row of record.items) {
      const item = parseCatalogCartItem(row);
      if (!item) return EMPTY_CATALOG_CART;
      items.push(item);
    }
    const merged = mergeCatalogCartItems(items);
    if (merged.length === 0) return EMPTY_CATALOG_CART;
    return { v: 1, items: merged };
  } catch {
    return EMPTY_CATALOG_CART;
  }
}

export function parseCatalogCartRequestItems(body: unknown): CatalogCartItem[] | null {
  if (!body || typeof body !== "object") return null;
  const items = (body as Record<string, unknown>).items;
  if (!Array.isArray(items)) return null;
  if (items.length > CATALOG_CART_MAX_ITEMS) return null;
  const parsed: CatalogCartItem[] = [];
  for (const row of items) {
    const item = parseCatalogCartItem(row);
    if (!item) return null;
    parsed.push(item);
  }
  return parsed;
}

export function catalogCartItemsEqual(a: CatalogCartItem[], b: CatalogCartItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      other != null &&
      item.plantId === other.plantId &&
      item.plantVariantId === other.plantVariantId &&
      item.potVariantId === other.potVariantId &&
      item.quantity === other.quantity
    );
  });
}

export function storedCatalogCartItems(
  lines: Array<Pick<CatalogCartItem, "plantId" | "plantVariantId" | "potVariantId" | "quantity">>,
): CatalogCartItem[] {
  return lines.map((line) => ({
    plantId: line.plantId,
    plantVariantId: line.plantVariantId,
    potVariantId: line.potVariantId,
    quantity: line.quantity,
  }));
}

export function addCatalogCartItem(
  cart: CatalogCart,
  input: Pick<CatalogCartItem, "plantId" | "plantVariantId" | "potVariantId">,
  stock: number,
): { cart: CatalogCart; added: boolean } {
  if (!Number.isInteger(stock) || stock <= 0) return { cart, added: false };
  const key = catalogCartItemKey(input);
  const items = cart.items.map((item) => ({ ...item }));
  const index = items.findIndex((item) => catalogCartItemKey(item) === key);
  if (index === -1) {
    items.push({
      plantId: input.plantId,
      plantVariantId: input.plantVariantId,
      potVariantId: input.potVariantId,
      quantity: 1,
    });
    return { cart: { v: 1, items }, added: true };
  }
  const existing = items[index];
  if (!existing || existing.quantity >= stock) return { cart, added: false };
  items[index] = { ...existing, quantity: existing.quantity + 1 };
  return { cart: { v: 1, items }, added: true };
}

export function updateCatalogCartQuantity(
  cart: CatalogCart,
  input: Pick<CatalogCartItem, "plantId" | "plantVariantId" | "potVariantId">,
  quantity: number,
  stock: number,
): CatalogCart {
  const key = catalogCartItemKey(input);
  if (!Number.isInteger(stock) || stock <= 0) {
    return removeCatalogCartItem(cart, input);
  }
  if (!Number.isInteger(quantity)) return cart;
  const nextQty = Math.min(Math.max(1, quantity), stock);
  return {
    v: 1,
    items: cart.items.map((item) =>
      catalogCartItemKey(item) === key ? { ...item, quantity: nextQty } : item,
    ),
  };
}

export function removeCatalogCartItem(
  cart: CatalogCart,
  input: Pick<CatalogCartItem, "plantId" | "plantVariantId" | "potVariantId">,
): CatalogCart {
  const key = catalogCartItemKey(input);
  const items = cart.items.filter((item) => catalogCartItemKey(item) !== key);
  return items.length === 0 ? EMPTY_CATALOG_CART : { v: 1, items };
}
