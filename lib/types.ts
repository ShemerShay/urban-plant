import type { InventoryType } from "@/lib/inventoryType";

export type CareLevel = "Easy" | "Moderate" | "Advanced";
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
  subtitle: string;
  subtitleHe?: string;
  description: string;
  descriptionHe?: string;
  /** Canonical catalog supplier price (DB: supplier_price). */
  supplierPrice: number;
  /** Same value as supplierPrice; kept for admin UI / API wire compatibility. */
  price: number;
  currency: "ILS" | "USD" | "EUR";
  images: string[];
  labels: string[];
  light: LightLevel;
  water: string;
  waterHe?: string;
  averageSize?: "small" | "medium" | "large" | "x-large";
  supplierName?: string;
  baseSupplierPrice?: number;
  createdAt?: string;
  difficulty: CareLevel;
  location: string;
  petFriendly: boolean;
  careInstructions: string[];
  /** Catalog inventory type. Existing rows default to plants. */
  inventoryType: InventoryType;
}
