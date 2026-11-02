/**
 * Load the Urban Plant pot catalog into pots + plant_library_images.
 * Uses the original generated PNG or JPEG files. Does not resize or re-encode them.
 *
 * Source photos default to the Desktop generated folder. Stable copies are
 * written to data/pot-catalog and stored in plant_library_images.
 * Photos that already live in data/plant-library are read from there and
 * are not copied into data/pot-catalog.
 *
 * Run: npm run db:seed:pot-catalog
 */
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { neon } from "@neondatabase/serverless";

import { loadEnvLocal } from "./load-env-local.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogDir = path.join(root, "data", "pot-catalog");
const libraryDir = path.join(root, "data", "plant-library");
const defaultSourceDir = "C:/Users/Shemer/Desktop/UrbanPlant/Pots/genertated";

/**
 * Standard tapered pots with no separate form note are stored as classic.
 * Tall and bowl are taken from the supplied form. Texture is stored only
 * where it was supplied.
 */
const CATALOG = [
  {
    filename: "pot-vaso-classic-14-terracotta.png",
    name: "טרקוטה קלאסי 14",
    family: "Vaso Classic",
    diameterCm: 14,
    material: "Terracotta",
    color: "Classic terracotta / orange",
    form: "classic",
    texture: null,
    match: (filename) =>
      filename.includes("14") && filename.includes("קלאסי") && !filename.includes("19"),
  },
  {
    filename: "pot-vaso-antique-14-brown.png",
    name: "טרקוטה חום 14",
    family: "Vaso Antique",
    diameterCm: 14,
    material: "Terracotta",
    color: "Brown / aged terracotta",
    form: "classic",
    texture: null,
    match: (filename) => filename.includes("14") && filename.includes("חום"),
  },
  {
    filename: "pot-vaso-classic-19-terracotta.png",
    name: "טרקוטה קלאסי 19",
    family: "Vaso Classic",
    diameterCm: 19,
    material: "Terracotta",
    color: "Classic terracotta / orange",
    form: "classic",
    texture: null,
    match: (filename) => filename.includes("19") && filename.includes("קלאסי"),
  },
  {
    filename: "pot-vaso-natural-19-beige.png",
    name: "טרקוטה טבעי 19",
    family: "Vaso Natural",
    diameterCm: 19,
    material: "Terracotta / natural clay finish",
    color: "Beige / warm grey-beige",
    form: "classic",
    texture: null,
    match: (filename) => filename.includes("19") && filename.includes("בז"),
  },
  {
    filename: "pot-vaso-alto-21-natural.png",
    name: "טרקוטה גבוה טבעי 21",
    family: "Vaso Alto",
    diameterCm: 21,
    material: "Terracotta / natural clay finish",
    color: "Beige / natural",
    form: "tall",
    texture: null,
    match: (filename) => filename.includes("21"),
  },
  {
    filename: "pot-vaso-alto-28-terracotta.png",
    name: "טרקוטה גבוה 28",
    family: "Vaso Alto",
    diameterCm: 28,
    material: "Terracotta",
    color: "Classic terracotta / orange",
    form: "tall",
    texture: null,
    match: (filename) => filename.includes("28"),
  },
  {
    filename: "pot-vaso-classic-36-light.png",
    name: "טרקוטה בהיר 36",
    family: "Vaso Classic",
    diameterCm: 36,
    material: "Terracotta",
    color: "Light terracotta / pale pink-beige",
    form: "classic",
    texture: null,
    match: (filename) => filename.includes("36"),
  },
  {
    filename: "pot-ciotola-ribbed-38-terracotta.png",
    name: "קערת טרקוטה מחורצת 38",
    family: "Ciotola Ribbed",
    diameterCm: 38,
    material: "Terracotta",
    color: "Terracotta / orange",
    form: "bowl",
    texture: "Ribbed",
    match: (filename) => filename.includes("38"),
  },
  {
    filename: "pot-ciotola-16-concrete-grey.png",
    name: "קערת בטון אפורה 16",
    family: "Ciotola",
    diameterCm: 16,
    material: "Concrete / stone-look",
    color: "Light grey",
    form: "bowl",
    texture: null,
    match: (filename) => filename.includes("16"),
  },
  {
    filename: "pot-vaso-textured-natural-terracotta.jpg",
    name: "טרקוטה טבעי מחורץ",
    family: "Vaso Textured",
    diameterCm: null,
    material: "Terracotta",
    color: "Natural terracotta / warm peach-beige",
    form: "classic",
    texture:
      "Textured horizontal band near the rim. Natural terracotta look. Softer, lighter tone than classic orange terracotta.",
    match: (filename) => filename === "pot-vaso-textured-natural-terracotta.jpg",
  },
  {
    filename: "pot-vaso-minimal-beige-ceramic.jpg",
    name: "קרמי בז׳ מינימליסטי",
    family: "Vaso Minimal",
    diameterCm: null,
    material: "Ceramic",
    color: "Beige / ivory / warm off-white",
    form: "classic",
    texture: "Smooth minimal finish. Clean, simple, modern look.",
    match: (filename) => filename === "pot-vaso-minimal-beige-ceramic.jpg",
  },
  {
    filename: "pot-concrete-classic-light-grey.jpg",
    name: "בטון אפור בהיר",
    family: "Concrete Classic",
    diameterCm: null,
    material: "Concrete / stone-look",
    color: "Light grey",
    form: "classic",
    texture:
      "Weathered concrete texture. Mineral/mottled surface. Natural stone-like finish.",
    match: (filename) => filename === "pot-concrete-classic-light-grey.jpg",
  },
  {
    filename: "pot-vaso-natural-14-beige-concrete.jpg",
    name: "קוטר 14 בטון בגוון בז׳ טבעי",
    family: "Vaso Natural",
    diameterCm: 14,
    material: "Concrete",
    color: "Warm beige / sand",
    form: "classic",
    texture:
      "Matte. Natural handmade texture. Small speckles and pits. Thin clean rim. No raised band or decorative groove.",
    match: (filename) => filename === "pot-vaso-natural-14-beige-concrete.jpg",
  },
  // Supplied shapes that are not classic, tall, or bowl stay form: null.
  {
    filename: "pot-vaso-alto-natural-beige.jpg",
    name: "כד גבוה בז׳ טבעי",
    family: "Vaso Alto Natural",
    diameterCm: null,
    material: "Terracotta / natural clay",
    color: "Warm beige / sand",
    form: "tall",
    texture: "Natural weathered texture with subtle horizontal marks",
    reusePlantLibrary: true,
  },
  {
    filename: "pot-vaso-rounded-terracotta.jpg",
    name: "כד טרקוטה מעוגל",
    family: "Vaso Rounded",
    diameterCm: null,
    material: "Terracotta",
    color: "Light terracotta / peach",
    form: null,
    texture: "Matte natural terracotta",
    reusePlantLibrary: true,
  },
  {
    filename: "pot-rounded-stone-cream.jpg",
    name: "כד אבן מעוגל בגוון שמנת",
    family: "Rounded Stone",
    diameterCm: null,
    material: "Concrete / stone-look",
    color: "Cream / light beige",
    form: "bowl",
    texture: "Natural mottled stone texture",
    reusePlantLibrary: true,
  },
  {
    filename: "pot-vaso-classic-light-peach.jpg",
    name: "טרקוטה קלאסי בהיר",
    family: "Vaso Classic",
    diameterCm: null,
    material: "Terracotta",
    color: "Light terracotta / peach",
    form: "classic",
    texture: "Light weathered terracotta texture",
    reusePlantLibrary: true,
  },
  {
    filename: "pot-vaso-ribbed-rounded-beige.jpg",
    name: "כד בז׳ מעוגל מחורץ",
    family: "Vaso Ribbed Rounded",
    diameterCm: null,
    material: "Terracotta / stone-look",
    color: "Light beige / cream",
    form: null,
    texture: "Horizontal grooves around the middle/lower body",
    reusePlantLibrary: true,
  },
  {
    filename: "pot-concrete-cube-off-white.jpg",
    name: "כד בטון מרובע לבן",
    family: "Concrete Cube",
    diameterCm: null,
    material: "Concrete",
    color: "Off-white / light grey",
    form: null,
    texture: "Matte concrete texture with subtle natural imperfections",
    reusePlantLibrary: true,
  },
];

function catalogImageMime(buffer, filename) {
  if (buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  throw new Error(`${filename} is not a PNG or JPEG`);
}

async function ensureCatalogFiles() {
  await mkdir(catalogDir, { recursive: true });
  const sourceDir = process.env.POT_CATALOG_SOURCE?.trim() || defaultSourceDir;
  let sourceNames = [];
  try {
    sourceNames = await readdir(sourceDir);
  } catch {
    sourceNames = [];
  }

  for (const item of CATALOG) {
    if (item.reusePlantLibrary) {
      try {
        await stat(path.join(libraryDir, item.filename));
      } catch {
        throw new Error(`Missing data/plant-library/${item.filename}`);
      }
      continue;
    }
    const destination = path.join(catalogDir, item.filename);
    try {
      await stat(destination);
      continue;
    } catch {
      // Copy the original PNG once.
    }
    const sourceName = sourceNames.find((name) => item.match(name));
    if (!sourceName) {
      throw new Error(`Missing source image for ${item.filename} in ${sourceDir}`);
    }
    await copyFile(path.join(sourceDir, sourceName), destination);
    console.log(`copied ${sourceName} -> data/pot-catalog/${item.filename}`);
  }
}

await loadEnvLocal();
await ensureCatalogFiles();

const sql = neon(process.env.DATABASE_URL);
const results = [];

for (const item of CATALOG) {
  const filePath = item.reusePlantLibrary
    ? path.join(libraryDir, item.filename)
    : path.join(catalogDir, item.filename);
  const buffer = await readFile(filePath);
  const mimeType = catalogImageMime(buffer, item.filename);

  await sql`
    INSERT INTO plant_library_images (filename, mime_type, data)
    VALUES (${item.filename}, ${mimeType}, ${buffer})
    ON CONFLICT (filename) DO UPDATE
    SET mime_type = EXCLUDED.mime_type,
        data = EXCLUDED.data,
        uploaded_at = now()
  `;

  const image = `/plant-library/${item.filename}`;
  const existing =
    item.diameterCm == null
      ? await sql`
          SELECT id
          FROM pots
          WHERE family = ${item.family}
            AND diameter_cm IS NULL
            AND color = ${item.color}
          LIMIT 1
        `
      : await sql`
          SELECT id
          FROM pots
          WHERE family = ${item.family}
            AND diameter_cm = ${item.diameterCm}
            AND color = ${item.color}
          LIMIT 1
        `;
  const current = existing[0];
  const rows = current
    ? await sql`
        UPDATE pots
        SET name = ${item.name},
            name_he = ${item.name},
            image = ${image},
            family = ${item.family},
            diameter_cm = ${item.diameterCm},
            material = ${item.material},
            color = ${item.color},
            form = ${item.form},
            texture = ${item.texture},
            active = true
        WHERE id = ${current.id}::uuid
        RETURNING id, name, family, diameter_cm, color, form, image, active
      `
    : await sql`
        INSERT INTO pots (
          name, name_he, image, family, diameter_cm, material, color, form, texture, active
        )
        VALUES (
          ${item.name},
          ${item.name},
          ${image},
          ${item.family},
          ${item.diameterCm},
          ${item.material},
          ${item.color},
          ${item.form},
          ${item.texture},
          true
        )
        RETURNING id, name, family, diameter_cm, color, form, image, active
      `;

  const stored = await sql`
    SELECT octet_length(data)::int AS bytes
    FROM plant_library_images
    WHERE filename = ${item.filename}
  `;
  const bytes = Number(stored[0]?.bytes ?? 0);
  if (bytes !== buffer.byteLength) {
    throw new Error(
      `${item.filename} stored ${bytes} bytes, file is ${buffer.byteLength}`,
    );
  }
  results.push({ ...rows[0], bytes, action: current ? "updated" : "inserted" });
}

console.log(JSON.stringify(results, null, 2));
console.log(`seed-pot-catalog: ${results.length} pots`);
