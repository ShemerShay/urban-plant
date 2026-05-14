import { PlantProduct } from "./types";

export const mockPlants: PlantProduct[] = [
  {
    id: "monstera",
    name: "Monstera Deliciosa",
    status: "available",
    subtitle: "Easy indoor plant",
    description:
      "A calm, sculptural plant that adds fresh character to indoor spaces. Great for creating a soft natural presence at home.",
    price: 89,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Easy to care", "Medium", "Statement leaves"],
    light: "Indirect bright light",
    water: "Every 4–6 days",
    difficulty: "Easy",
    location: "Near a bright window",
    petFriendly: false,
    careInstructions: [
      "Bright indirect light; avoid harsh midday sun on leaves.",
      "Water when the top soil feels dry.",
      "Wipe leaves occasionally for shine.",
    ],
    commercialCopy: "A sculptural classic that feels premium without trying too hard.",
  },
  {
    id: "alocasia",
    name: "Alocasia",
    status: "available",
    subtitle: "Bold tropical contrast",
    description:
      "Arrow-shaped leaves with striking veins—an eye-catching accent that reads upscale and intentional.",
    price: 169,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1593691509543-c55fb32e7355?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Moderate care", "Medium", "Tropical"],
    light: "Indirect bright light",
    water: "Every 4-6 days",
    difficulty: "Moderate",
    location: "Warm spot with indirect light",
    petFriendly: false,
    careInstructions: [
      "Keep soil lightly moist; avoid soggy roots.",
      "Higher humidity helps leaf edges stay crisp.",
      "Rotate weekly for even growth.",
    ],
    commercialCopy: "High-impact greenery that elevates any shelf or seating nook.",
  },
  {
    id: "asparagus",
    name: "Asparagus fern",
    status: "available",
    subtitle: "Soft airy texture",
    description:
      "Feathery, delicate foliage that adds movement and a relaxed botanical vibe to tight spaces.",
    price: 89,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1463947628408-f8581a2f4aca?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1416879595882-3373a0480b7b?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Easy to care", "Small", "Trailing"],
    light: "Indirect bright light",
    water: "Every 3-5 days",
    difficulty: "Easy",
    location: "Bright indirect spot",
    petFriendly: false,
    careInstructions: [
      "Keep evenly moist but not waterlogged.",
      "Prune brown stems to keep it airy.",
      "Protect from drying heat vents.",
    ],
    commercialCopy: "Light, playful greenery—friendly for desks and small tables.",
  },
  {
    id: "olive-01",
    name: "Mediterranean Olive",
    status: "available",
    subtitle: "Premium indoor tree",
    description:
      "A timeless olive tree that brings a soft Mediterranean character to cafés, living rooms, and workspaces.",
    price: 249,
    currency: "ILS",
    images: [
      "https://images.unsplash.com/photo-1463320898484-cdee8141c787?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=1200&q=80",
    ],
    labels: ["Easy to care", "Small", "Flowering plant"],
    light: "Indirect bright light",
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
    commercialCopy:
      "A statement plant that instantly elevates your space with calm, natural elegance.",
  },
];

export function getPlantById(id: string): PlantProduct | undefined {
  return mockPlants.find((plant) => plant.id === id);
}

export function formatPrice(price: number, currency: PlantProduct["currency"]) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

/** Single-line CTA copy for product/checkout (ILS uses ₪ without space). */
export function formatBuyCta(price: number, currency: PlantProduct["currency"]) {
  if (currency === "ILS") return `Buy for ₪${price}`;
  return `Buy for ${formatPrice(price, currency)}`;
}
