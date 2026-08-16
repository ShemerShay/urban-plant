import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MAX_PLANT_IMAGE_UPLOAD_BYTES,
  PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_UNPROCESSABLE_MESSAGE,
  PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE,
  PlantImageUploadError,
  resolvePlantImageMime,
} from "@/lib/plantImageUpload";
import { routes } from "@/lib/routes";

/** Public URL prefix for the plant image library (filesystem folder name matches). */
export const PLANT_LIBRARY_PUBLIC_PREFIX = "/plant-library";

const LIBRARY_DIR = path.join(process.cwd(), "public", "plant-library");

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const SAFE_FILENAME = /^[a-z0-9][a-z0-9-]*\.(jpg|jpeg|png|webp|gif)$/i;

export type PlantLibraryImage = {
  url: string;
  filename: string;
  uploadedAt?: string;
};

function useDatabaseStorage(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function isMissingPlantLibraryTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  return message.includes("plant_library_images") && message.includes("does not exist");
}

export function isSafePlantLibraryFilename(filename: string): boolean {
  const base = path.basename(filename);
  return base === filename && SAFE_FILENAME.test(base);
}

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

function buildFilename(mimeType: string, originalName: string): string {
  const ext = EXT_BY_MIME[mimeType] ?? ".jpg";
  return `${sanitizeBaseName(originalName)}-${randomUUID().slice(0, 8)}${ext}`;
}

export async function listPlantLibraryImages(): Promise<PlantLibraryImage[]> {
  if (useDatabaseStorage()) {
    try {
      const { listPlantLibraryImagesFromDb } = await import("@/lib/plantImageDbStorage");
      return await listPlantLibraryImagesFromDb();
    } catch (error) {
      if (isMissingPlantLibraryTableError(error)) {
        throw new Error(
          "Plant image library table is missing. Run: npm run db:migrate:plant-images",
        );
      }
      throw error;
    }
  }

  await ensurePlantLibraryDir();
  const entries = await readdir(LIBRARY_DIR);
  const images: PlantLibraryImage[] = [];

  for (const filename of entries) {
    if (filename.startsWith(".")) continue;
    const filePath = path.join(LIBRARY_DIR, filename);
    const info = await stat(filePath);
    if (!info.isFile()) continue;
    images.push({
      url: routes.plantLibrary(filename),
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
  const resolvedMime = resolvePlantImageMime(mimeType, originalName);
  if (!resolvedMime) {
    throw new PlantImageUploadError(PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE);
  }
  if (buffer.byteLength > MAX_PLANT_IMAGE_UPLOAD_BYTES) {
    throw new PlantImageUploadError(PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE);
  }

  let optimized;
  try {
    const { optimizePlantImage } = await import("@/lib/optimizePlantImage");
    optimized = await optimizePlantImage(buffer, resolvedMime);
  } catch {
    throw new PlantImageUploadError(PLANT_IMAGE_UNPROCESSABLE_MESSAGE);
  }
  const storedBuffer = optimized.data;
  const storedMime = optimized.mimeType;
  const filename = buildFilename(storedMime, originalName);

  if (useDatabaseStorage()) {
    try {
      const { savePlantLibraryImageToDb } = await import("@/lib/plantImageDbStorage");
      return await savePlantLibraryImageToDb(storedBuffer, storedMime, filename);
    } catch (error) {
      if (isMissingPlantLibraryTableError(error)) {
        throw new Error(
          "Plant image library table is missing. Run: npm run db:migrate:plant-images",
        );
      }
      throw error;
    }
  }

  await ensurePlantLibraryDir();
  const filePath = path.join(LIBRARY_DIR, filename);
  await writeFile(filePath, storedBuffer);

  return {
    url: routes.plantLibrary(filename),
    filename,
    uploadedAt: new Date().toISOString(),
  };
}

export async function getPlantLibraryImageBytes(
  filename: string,
): Promise<{ mimeType: string; data: Buffer } | null> {
  if (!isSafePlantLibraryFilename(filename)) return null;

  if (useDatabaseStorage()) {
    try {
      const { getPlantLibraryImageFromDb } = await import("@/lib/plantImageDbStorage");
      return await getPlantLibraryImageFromDb(filename);
    } catch (error) {
      if (isMissingPlantLibraryTableError(error)) return null;
      throw error;
    }
  }

  const filePath = path.join(LIBRARY_DIR, filename);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filename).toLowerCase();
    const mimeType =
      ext === ".png"
        ? "image/png"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/jpeg";
    return { mimeType, data };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
