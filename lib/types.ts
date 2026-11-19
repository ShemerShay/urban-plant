import type { InventoryType } from "@/lib/inventoryType";

export type LightLevel =
  | "Low light"
  | "Medium light"
  | "Bright indirect light"
  | "Direct sun";

export interface PlantProduct {
  id: string;
  name: string;
  nameHe?: string;
  family?: string;
  subtitle?: string;
  subtitleHe?: string;
  description?: string;
  descriptionHe?: string;
  /** Canonical catalog supplier cost (DB: supplier_price). */
  supplierPrice: number;
  currency: "ILS" | "USD" | "EUR";
  images?: string[];
  labels?: string[];
  light?: LightLevel;
  water?: string;
  waterHe?: string;
  supplierName?: string;
  baseSupplierPrice?: number;
  createdAt?: string;
  location?: string;
  petFriendly?: boolean;
  careInstructions?: string[];
  /** Catalog inventory type. Existing rows default to plants. */
  inventoryType: InventoryType;
  /** Public Catalog visibility. Independent of stock and of POS. Default false. */
  catalogPublished?: boolean;
}
