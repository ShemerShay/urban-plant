export type CareLevel = "Easy" | "Moderate" | "Advanced";
export type LightLevel = "Low light" | "Indirect bright light" | "Full sun";

export interface PlantProduct {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  price: number;
  currency: "ILS" | "USD" | "EUR";
  images: string[];
  labels: string[];
  light: LightLevel;
  water: string;
  difficulty: CareLevel;
  location: string;
  petFriendly: boolean;
  careInstructions: string[];
  commercialCopy: string;
}
