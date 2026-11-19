import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { deletePlantLibraryBlob, readPlantLibraryBlob, writePlantLibraryBlob } from "@/lib/plantImageBlobs";

import {
  MAX_PLANT_IMAGE_UPLOAD_BYTES,
  PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_UNPROCESSABLE_MESSAGE,
  PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE,
  PlantImageUploadError,
  resolvePlantImageMime,
} from "@/lib/plantImageUpload";
import { routes } from "@/lib/routes";

/** Public URL prefix for the plant image library. */
export const PLANT_LIBRARY_PUBLIC_PREFIX = "/plant-library";

// Not under public/: a same-path file there is served by Next with the filename
// extension as Content-Type, and 30 stored JPEGs use .png names.
const LIBRARY_DIR = path.join(process.cwd(), "data", "plant-library");

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
  await writePlantLibraryBlob(filename, storedBuffer);

  if (useDatabaseStorage()) {
    try {
      const { savePlantLibraryImageToDb } = await import("@/lib/plantImageDbStorage");
      return await savePlantLibraryImageToDb(storedBuffer, storedMime, filename);
    } catch (error) {
      try {
        await deletePlantLibraryBlob(filename);
      } catch (cleanupError) {
        const archiveMessage = error instanceof Error ? error.message : "Image archive insert failed";
        const cleanupMessage =
          cleanupError instanceof Error ? cleanupError.message : "blob delete failed";
        throw new Error(
          `${archiveMessage}. The uploaded image blob ${filename} could not be removed: ${cleanupMessage}`,
        );
      }
      if (isMissingPlantLibraryTableError(error)) {
        throw new Error(
          "Plant image library table is missing. Run: npm run db:migrate:plant-images",
        );
      }
      throw error;
    }
  }

  return {
    url: routes.plantLibrary(filename),
    filename,
    uploadedAt: new Date().toISOString(),
  };
}

function mimeTypeForImageBytes(filename: string, data: Buffer): string {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return "image/png";
  }
  if (data.length >= 6) {
    const gif = data.subarray(0, 6).toString("ascii");
    if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

export async function getPlantLibraryImageBytes(
  filename: string,
): Promise<{ mimeType: string; data: Buffer } | null> {
  if (!isSafePlantLibraryFilename(filename)) return null;

  const filePath = path.join(LIBRARY_DIR, filename);
  try {
    const data = await readFile(filePath);
    return { mimeType: mimeTypeForImageBytes(filename, data), data };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  const blob = await readPlantLibraryBlob(filename);
  if (!blob) return null;
  return { mimeType: mimeTypeForImageBytes(filename, blob), data: blob };
}
