import type { PlantProduct } from "./types";

const SEED_ENTRIES: Omit<PlantProduct, "price">[] = [
  {
    id: "monstera",
    name: "Monstera Deliciosa",
    subtitle: "Big leaves. Low drama.",
    description:
      "A sculptural indoor plant with bold leaves and a calm presence. Easy to style, easy to love.",
    supplierPrice: 89,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Easy to care", "Medium", "Statement leaves"],
    light: "Bright indirect light",
    water: "Every 4–6 days",
    difficulty: "Easy",
    location: "Near a bright window",
    petFriendly: false,
    careInstructions: [
      "Bright indirect light; avoid harsh midday sun on leaves.",
      "Water when the top soil feels dry.",
      "Wipe leaves occasionally for shine.",
    ],
    averageSize: "medium",
  },
  {
    id: "alocasia",
    name: "Alocasia",
    subtitle: "Bold tropical contrast",
    description:
      "Arrow-shaped leaves with striking veins—an eye-catching accent that reads upscale and intentional.",
    supplierPrice: 169,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1593691509543-c55fb32e7355?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Moderate care", "Medium", "Tropical"],
    light: "Medium light",
    water: "Every 4-6 days",
    difficulty: "Moderate",
    location: "Warm spot with indirect light",
    petFriendly: false,
    careInstructions: [
      "Keep soil lightly moist; avoid soggy roots.",
      "Higher humidity helps leaf edges stay crisp.",
      "Rotate weekly for even growth.",
    ],
    averageSize: "medium",
  },
  {
    id: "asparagus",
    name: "Asparagus fern",
    family: "Asparagaceae",
    subtitle: "Soft airy texture",
    averageSize: "small",
    description:
      "Feathery, delicate foliage that adds movement and a relaxed botanical vibe to tight spaces.",
    supplierPrice: 89,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1463947628408-f8581a2f4aca?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1416879595882-3373a0480b7b?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Easy to care", "Small", "Trailing"],
    light: "Low light",
    water: "Every 3-5 days",
    difficulty: "Easy",
    location: "Bright indirect spot",
    petFriendly: false,
    careInstructions: [
      "Keep evenly moist but not waterlogged.",
      "Prune brown stems to keep it airy.",
      "Protect from drying heat vents.",
    ],
  },
  {
    id: "olive-01",
    name: "Mediterranean Olive",
    subtitle: "Premium indoor tree",
    description:
      "A timeless olive tree that brings a soft Mediterranean character to cafés, living rooms, and workspaces.",
    supplierPrice: 249,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1463320898484-cdee8141c787?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Easy to care", "Small", "Flowering plant"],
    light: "Direct sun",
    water: "Every 5-7 days",
    difficulty: "Moderate",
    location: "Near a bright window",
    petFriendly: false,
    careInstructions: [
      "Keep in bright indirect sun for at least 6 hours daily.",
      "Let the top 2-3 cm of soil dry between watering.",
      "Rotate the pot weekly for balanced growth.",
      "Wipe leaves gently once a month to remove dust.",
    ],
    averageSize: "large",
  },
];

/** Default catalog when DB is empty (seed / fallback). */
export const PLANTS_CATALOG_SEED: PlantProduct[] = SEED_ENTRIES.map((plant) => ({
  ...plant,
  price: plant.supplierPrice,
}));
