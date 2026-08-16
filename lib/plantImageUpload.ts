/** Shared upload policy for admin plant photos. Safe to import from client code. */

/** Original file selected in the admin UI. Generous enough for phone photos. */
export const MAX_PLANT_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;
export const MAX_PLANT_IMAGE_SOURCE_MB = 25;

/**
 * Payload actually sent to `/api/plant-images`.
 * Must stay under Netlify's ~4.4 MB function body cliff (multipart included).
 */
export const MAX_PLANT_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_PLANT_IMAGE_UPLOAD_MB = 4;

export const PLANT_IMAGE_BROWSER_MAX_EDGE = 1280;

export const ALLOWED_PLANT_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export const PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE =
  "This file type is not supported. Please choose a JPEG, PNG, WebP, or GIF image.";

export const PLANT_IMAGE_SOURCE_TOO_LARGE_MESSAGE =
  "This photo is too large to open. Please choose an image smaller than 25 MB.";

export const PLANT_IMAGE_GIF_TOO_LARGE_MESSAGE =
  "This GIF is too large to upload. Please choose a GIF smaller than 4 MB, or use a JPEG or PNG instead.";

export const PLANT_IMAGE_PREPROCESS_FAILED_MESSAGE =
  "This image could not be prepared for upload. Please try a different JPEG, PNG, or WebP photo.";

export const PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE =
  "The image is still too large to upload. Please choose a smaller JPEG, PNG, or WebP photo.";

export const PLANT_IMAGE_UPLOAD_FAILED_MESSAGE =
  "The image could not be uploaded. Please try again, or choose a different JPEG, PNG, WebP, or GIF.";

export const PLANT_IMAGE_UNPROCESSABLE_MESSAGE =
  "This image could not be processed. Please choose a different JPEG, PNG, WebP, or GIF image.";

export class PlantImageUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlantImageUploadError";
  }
}

export function resolvePlantImageMime(mimeType: string, filename: string): string | null {
  if (ALLOWED_PLANT_IMAGE_MIME.has(mimeType)) return mimeType;
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? null;
}
