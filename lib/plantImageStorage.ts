import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const PLANT_LIBRARY_PUBLIC_PREFIX = "/plant-library";

const LIBRARY_DIR = path.join(process.cwd(), "public", "plant-library");

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const MAX_PLANT_IMAGE_BYTES = 5 * 1024 * 1024;

export type PlantLibraryImage = {
  url: string;
  filename: string;
  uploadedAt?: string;
};

export async function ensurePlantLibraryDir(): Promise<void> {
  await mkdir(LIBRARY_DIR, { recursive: true });
}

function sanitizeBaseName(name: string): string {
  const base = path.basename(name, path.extname(name));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 48) || "plant";
}

export async function listPlantLibraryImages(): Promise<PlantLibraryImage[]> {
  await ensurePlantLibraryDir();
  const entries = await readdir(LIBRARY_DIR);
  const images: PlantLibraryImage[] = [];

  for (const filename of entries) {
    if (filename.startsWith(".")) continue;
    const filePath = path.join(LIBRARY_DIR, filename);
    const info = await stat(filePath);
    if (!info.isFile()) continue;
    images.push({
      url: `${PLANT_LIBRARY_PUBLIC_PREFIX}/${filename}`,
      filename,
      uploadedAt: info.mtime.toISOString(),
    });
  }

  images.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
  return images;
}

export async function savePlantLibraryImage(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<PlantLibraryImage> {
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new Error("File must be JPEG, PNG, WebP, or GIF");
  }
  if (buffer.byteLength > MAX_PLANT_IMAGE_BYTES) {
    throw new Error("Image must be 5 MB or smaller");
  }

  await ensurePlantLibraryDir();
  const ext = EXT_BY_MIME[mimeType] ?? ".jpg";
  const filename = `${sanitizeBaseName(originalName)}-${randomUUID().slice(0, 8)}${ext}`;
  const filePath = path.join(LIBRARY_DIR, filename);
  await writeFile(filePath, buffer);

  return {
    url: `${PLANT_LIBRARY_PUBLIC_PREFIX}/${filename}`,
    filename,
    uploadedAt: new Date().toISOString(),
  };
}
