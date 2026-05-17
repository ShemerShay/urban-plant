export type CareLevel = "Easy" | "Moderate" | "Advanced";
export type LightLevel = "Low light" | "Indirect bright light" | "Full sun";

/** Catalog-level availability (independent of per-location shelf inventory). */
export type PlantCatalogStatus = "available" | "sold";

export interface PlantProduct {
  id: string;
  name: string;
  family?: string;
  status: PlantCatalogStatus;
  subtitle: string;
  description: string;
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
