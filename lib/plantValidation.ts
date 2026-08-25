import { parseInventoryType } from "@/lib/inventoryType";
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

function readBodyField(
  body: Record<string, unknown>,
  camel: string,
  snake: string,
): { omitted: true } | { omitted: false; value: unknown } {
  if (Object.prototype.hasOwnProperty.call(body, camel)) {
    return { omitted: false, value: body[camel] };
  }
  if (camel !== snake && Object.prototype.hasOwnProperty.call(body, snake)) {
    return { omitted: false, value: body[snake] };
  }
  return { omitted: true };
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

function parseStringArray(value: unknown): string[] | null {
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

function rejectBlankString(value: unknown, field: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} is required` };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: false, error: `${field} is required` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Flowers: omit or JSON null. Empty string / empty array is rejected.
 */
function optionalFlowerText(
  body: Record<string, unknown>,
  camel: string,
  snake: string,
): { ok: true; value?: string } | { ok: false; error: string } {
  const field = readBodyField(body, camel, snake);
  if (field.omitted) return { ok: true };
  const raw = field.value;
  if (raw === null) return { ok: true };
  if (typeof raw !== "string") {
    return { ok: false, error: `${camel} must be a string or null` };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${camel} must be omitted, null, or a non-empty string` };
  }
  return { ok: true, value: trimmed };
}

function optionalFlowerArray(
  body: Record<string, unknown>,
  camel: string,
  snake: string,
): { ok: true; value?: string[] } | { ok: false; error: string } {
  const field = readBodyField(body, camel, snake);
  if (field.omitted) return { ok: true };
  const raw = field.value;
  if (raw === null) return { ok: true };
  const parsed = parseStringArray(raw);
  if (!parsed) {
    return {
      ok: false,
      error: `${camel} must be omitted, null, or include at least one item`,
    };
  }
  return { ok: true, value: parsed };
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

  const inventoryTypeRaw = body.inventoryType ?? body.inventory_type;
  let inventoryType: PlantProduct["inventoryType"] = "plants";
  if (inventoryTypeRaw !== undefined && inventoryTypeRaw !== null && inventoryTypeRaw !== "") {
    const parsedType = parseInventoryType(inventoryTypeRaw);
    if (!parsedType) {
      return { ok: false, error: "inventoryType must be plants or flowers" };
    }
    inventoryType = parsedType;
  }

  const name = cleanString(body.name);
  if (!name) return { ok: false, error: "name is required" };

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

  const nameHe = cleanString(body.nameHe ?? body.name_he);
  const family = cleanString(body.family);
  const supplierName = cleanString(body.supplierName);
  const baseSupplierPrice = parseOptionalNumber(body.baseSupplierPrice);
  const averageSizeRaw = cleanString(body.averageSize);
  let averageSize: PlantProduct["averageSize"];
  if (averageSizeRaw) {
    if (!AVERAGE_SIZES.has(averageSizeRaw as NonNullable<PlantProduct["averageSize"]>)) {
      return { ok: false, error: "averageSize must be small, medium, large, or x-large" };
    }
    averageSize = averageSizeRaw as PlantProduct["averageSize"];
  }

  if (inventoryType === "flowers") {
    const subtitle = optionalFlowerText(body, "subtitle", "subtitle");
    if (!subtitle.ok) return subtitle;
    const subtitleHe = optionalFlowerText(body, "subtitleHe", "subtitle_he");
    if (!subtitleHe.ok) return subtitleHe;
    const description = optionalFlowerText(body, "description", "description");
    if (!description.ok) return description;
    const descriptionHe = optionalFlowerText(body, "descriptionHe", "description_he");
    if (!descriptionHe.ok) return descriptionHe;
    const water = optionalFlowerText(body, "water", "water");
    if (!water.ok) return water;
    const waterHe = optionalFlowerText(body, "waterHe", "water_he");
    if (!waterHe.ok) return waterHe;
    const location = optionalFlowerText(body, "location", "location");
    if (!location.ok) return location;

    const images = optionalFlowerArray(body, "images", "images");
    if (!images.ok) return images;
    const labels = optionalFlowerArray(body, "labels", "labels");
    if (!labels.ok) return labels;
    const careInstructions = optionalFlowerArray(body, "careInstructions", "care_instructions");
    if (!careInstructions.ok) return careInstructions;

    let light: LightLevel | undefined;
    const lightField = readBodyField(body, "light", "light");
    if (!lightField.omitted) {
      if (lightField.value === null) {
        light = undefined;
      } else {
        const lightRaw = cleanString(lightField.value);
        if (!lightRaw) {
          return { ok: false, error: "light must be omitted, null, or a valid light level" };
        }
        if (!LIGHT_LEVELS.has(lightRaw as LightLevel)) {
          return {
            ok: false,
            error:
              'light must be "Low light", "Medium light", "Bright indirect light", or "Direct sun"',
          };
        }
        light = lightRaw as LightLevel;
      }
    }

    let difficulty: CareLevel | undefined;
    const difficultyField = readBodyField(body, "difficulty", "difficulty");
    if (!difficultyField.omitted) {
      if (difficultyField.value === null) {
        difficulty = undefined;
      } else {
        const difficultyRaw = cleanString(difficultyField.value);
        if (!difficultyRaw) {
          return { ok: false, error: "difficulty must be omitted, null, or Easy, Moderate, or Advanced" };
        }
        if (!DIFFICULTIES.has(difficultyRaw as CareLevel)) {
          return { ok: false, error: "difficulty must be Easy, Moderate, or Advanced" };
        }
        difficulty = difficultyRaw as CareLevel;
      }
    }

    let petFriendly: boolean | undefined;
    const petField = readBodyField(body, "petFriendly", "pet_friendly");
    if (!petField.omitted) {
      const raw = petField.value;
      if (raw === null) {
        petFriendly = undefined;
      } else if (typeof raw === "boolean") {
        petFriendly = raw;
      } else if (raw === "true" || raw === "1") {
        petFriendly = true;
      } else if (raw === "false" || raw === "0") {
        petFriendly = false;
      } else {
        return { ok: false, error: "petFriendly must be a boolean or null" };
      }
    }

    const plant: PlantProduct = {
      id: resolvedId,
      name,
      supplierPrice,
      price: supplierPrice,
      currency: currencyRaw as PlantProduct["currency"],
      inventoryType: "flowers",
      ...(nameHe ? { nameHe } : {}),
      ...(family ? { family } : {}),
      ...(subtitle.value ? { subtitle: subtitle.value } : {}),
      ...(subtitleHe.value ? { subtitleHe: subtitleHe.value } : {}),
      ...(description.value ? { description: description.value } : {}),
      ...(descriptionHe.value ? { descriptionHe: descriptionHe.value } : {}),
      ...(images.value ? { images: images.value } : {}),
      ...(labels.value ? { labels: labels.value } : {}),
      ...(light ? { light } : {}),
      ...(water.value ? { water: water.value } : {}),
      ...(waterHe.value ? { waterHe: waterHe.value } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(location.value ? { location: location.value } : {}),
      ...(petFriendly !== undefined ? { petFriendly } : {}),
      ...(careInstructions.value ? { careInstructions: careInstructions.value } : {}),
      ...(averageSize ? { averageSize } : {}),
      ...(supplierName ? { supplierName } : {}),
      ...(baseSupplierPrice !== undefined ? { baseSupplierPrice } : {}),
    };
    return { ok: true, plant };
  }

  const subtitle = rejectBlankString(body.subtitle, "subtitle");
  if (!subtitle.ok) return subtitle;
  const description = rejectBlankString(body.description, "description");
  if (!description.ok) return description;
  const water = rejectBlankString(body.water, "water");
  if (!water.ok) return water;
  const location = rejectBlankString(body.location, "location");
  if (!location.ok) return location;

  const subtitleHe = cleanString(body.subtitleHe ?? body.subtitle_he);
  const descriptionHe = cleanString(body.descriptionHe ?? body.description_he);
  const waterHe = cleanString(body.waterHe ?? body.water_he);

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

  const images = parseStringArray(body.images);
  if (!images) {
    return { ok: false, error: "images must include at least one URL" };
  }

  const labels = parseStringArray(body.labels);
  if (!labels) {
    return { ok: false, error: "labels must include at least one item" };
  }

  const careInstructions = parseStringArray(body.careInstructions);
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

  const plant: PlantProduct = {
    id: resolvedId,
    name,
    subtitle: subtitle.value,
    description: description.value,
    supplierPrice,
    price: supplierPrice,
    currency: currencyRaw as PlantProduct["currency"],
    images,
    labels,
    light: lightRaw as LightLevel,
    water: water.value,
    difficulty: difficultyRaw as CareLevel,
    location: location.value,
    petFriendly,
    careInstructions,
    inventoryType: "plants",
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
