import type { CareLevel, LightLevel, PlantProduct } from "@/lib/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Legacy catalog ids (seed data) remain valid until migrated. */
const LEGACY_PLANT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidPlantId(id: string): boolean {
  return UUID_PATTERN.test(id) || LEGACY_PLANT_ID_PATTERN.test(id);
}
const CURRENCIES = new Set<PlantProduct["currency"]>(["ILS", "USD", "EUR"]);
const DIFFICULTIES = new Set<CareLevel>(["Easy", "Moderate", "Advanced"]);
const LIGHT_LEVELS = new Set<LightLevel>([
  "Low light",
  "Medium light",
  "Bright indirect light",
  "Direct sun",
]);
const AVERAGE_SIZES = new Set<NonNullable<PlantProduct["averageSize"]>>([
  "small",
  "medium",
  "large",
  "x-large",
]);

export type PlantParseResult =
  | { ok: true; plant: PlantProduct }
  | { ok: false; error: string };

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** When the body omits a Hebrew field, keep the existing catalog value on update. */
export function localizedFieldFromBody(
  body: Record<string, unknown>,
  existing: string | undefined,
  camel: string,
  snake: string,
): string | undefined {
  if (!(camel in body) && !(snake in body)) return existing;
  const value = cleanString(body[camel] ?? body[snake]);
  return value || undefined;
}

function parseStringArray(value: unknown, field: string): string[] | null {
  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }
  if (typeof value === "string") {
    const items = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return items.length > 0 ? items : null;
  }
  return null;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function parsePlantBody(
  body: Record<string, unknown>,
  options: { requireId: boolean; existingId?: string },
): PlantParseResult {
  const id = cleanString(body.id);
  if (options.requireId && !id) {
    return { ok: false, error: "id is required" };
  }
  if (id && !isValidPlantId(id)) {
    return {
      ok: false,
      error: "id must be a UUID or legacy catalog slug",
    };
  }
  if (options.existingId && id && id !== options.existingId) {
    return { ok: false, error: "id cannot be changed" };
  }

  const resolvedId = options.existingId ?? id;
  if (!resolvedId) {
    return { ok: false, error: "id is required" };
  }

  const name = cleanString(body.name);
  const nameHe = cleanString(body.nameHe ?? body.name_he);
  const subtitle = cleanString(body.subtitle);
  const subtitleHe = cleanString(body.subtitleHe ?? body.subtitle_he);
  const description = cleanString(body.description);
  const descriptionHe = cleanString(body.descriptionHe ?? body.description_he);
  const water = cleanString(body.water);
  const waterHe = cleanString(body.waterHe ?? body.water_he);
  const location = cleanString(body.location);
  const family = cleanString(body.family);
  const supplierName = cleanString(body.supplierName);

  if (!name) return { ok: false, error: "name is required" };
  if (!subtitle) return { ok: false, error: "subtitle is required" };
  if (!description) return { ok: false, error: "description is required" };
  if (!water) return { ok: false, error: "water is required" };
  if (!location) return { ok: false, error: "location is required" };

  const currencyRaw = cleanString(body.currency);
  if (!CURRENCIES.has(currencyRaw as PlantProduct["currency"])) {
    return { ok: false, error: "currency must be ILS, USD, or EUR" };
  }

  const supplierPriceRaw =
    body.supplierPrice ?? body.supplier_price ?? body.price;
  const supplierPrice =
    typeof supplierPriceRaw === "number" &&
    Number.isFinite(supplierPriceRaw) &&
    supplierPriceRaw >= 0
      ? supplierPriceRaw
      : null;
  if (supplierPrice === null) {
    return { ok: false, error: "supplierPrice must be a non-negative number" };
  }

  const difficultyRaw = cleanString(body.difficulty);
  if (!DIFFICULTIES.has(difficultyRaw as CareLevel)) {
    return { ok: false, error: "difficulty must be Easy, Moderate, or Advanced" };
  }

  const lightRaw = cleanString(body.light);
  if (!LIGHT_LEVELS.has(lightRaw as LightLevel)) {
    return {
      ok: false,
      error:
        'light must be "Low light", "Medium light", "Bright indirect light", or "Direct sun"',
    };
  }

  const images = parseStringArray(body.images, "images");
  if (!images) {
    return { ok: false, error: "images must include at least one URL" };
  }

  const labels = parseStringArray(body.labels, "labels");
  if (!labels) {
    return { ok: false, error: "labels must include at least one item" };
  }

  const careInstructions = parseStringArray(body.careInstructions, "careInstructions");
  if (!careInstructions) {
    return { ok: false, error: "careInstructions must include at least one item" };
  }

  let petFriendly = false;
  if (typeof body.petFriendly === "boolean") {
    petFriendly = body.petFriendly;
  } else if (body.petFriendly === "true" || body.petFriendly === "1") {
    petFriendly = true;
  } else if (body.petFriendly === "false" || body.petFriendly === "0") {
    petFriendly = false;
  } else if (body.petFriendly !== undefined && body.petFriendly !== null) {
    return { ok: false, error: "petFriendly must be a boolean" };
  }

  let averageSize: PlantProduct["averageSize"];
  const averageSizeRaw = cleanString(body.averageSize);
  if (averageSizeRaw) {
    if (!AVERAGE_SIZES.has(averageSizeRaw as NonNullable<PlantProduct["averageSize"]>)) {
      return { ok: false, error: "averageSize must be small, medium, large, or x-large" };
    }
    averageSize = averageSizeRaw as PlantProduct["averageSize"];
  }

  const baseSupplierPrice = parseOptionalNumber(body.baseSupplierPrice);

  const plant: PlantProduct = {
    id: resolvedId,
    name,
    subtitle,
    description,
    supplierPrice,
    price: supplierPrice,
    currency: currencyRaw as PlantProduct["currency"],
    images,
    labels,
    light: lightRaw as LightLevel,
    water,
    difficulty: difficultyRaw as CareLevel,
    location,
    petFriendly,
    careInstructions,
    ...(nameHe ? { nameHe } : {}),
    ...(family ? { family } : {}),
    ...(subtitleHe ? { subtitleHe } : {}),
    ...(descriptionHe ? { descriptionHe } : {}),
    ...(waterHe ? { waterHe } : {}),
    ...(averageSize ? { averageSize } : {}),
    ...(supplierName ? { supplierName } : {}),
    ...(baseSupplierPrice !== undefined ? { baseSupplierPrice } : {}),
  };

  return { ok: true, plant };
}
