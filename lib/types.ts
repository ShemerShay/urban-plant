export type CareLevel = "Easy" | "Moderate" | "Advanced";
export type LightLevel = "Low light" | "Indirect bright light" | "Full sun";

export interface PlantProduct {
  id: string;
  name: string;
  family?: string;
  subtitle: string;
  description: string;
  /** Canonical catalog supplier price (DB: supplier_price). */
  supplierPrice: number;
  /** Same value as supplierPrice; kept for admin UI / API wire compatibility. */
  price: number;
  currency: "ILS" | "USD" | "EUR";
  images: string[];
  labels: string[];
  light: LightLevel;
  water: string;
  averageSize?: "small" | "medium" | "large";
  maintenanceConditions?: string;
  supplierName?: string;
  baseSupplierPrice?: number;
  createdAt?: string;
  difficulty: CareLevel;
  location: string;
  petFriendly: boolean;
  careInstructions: string[];
  commercialCopy: string;
}
