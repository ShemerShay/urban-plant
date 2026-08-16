/**
 * Resize/compress plant photos for POS display.
 * Gallery is max-w-md (448px) at up to ~3x DPR, so 1280px on the long edge is enough.
 * Does not change filenames or the plants.images URL model.
 */
import sharp from "sharp";

export const PLANT_IMAGE_MAX_EDGE = 1280;
export const PLANT_IMAGE_JPEG_QUALITY = 82;
export const PLANT_IMAGE_WEBP_QUALITY = 80;
/** Already-small display JPEGs/WebPs are left alone (idempotent re-runs). */
export const PLANT_IMAGE_SKIP_MAX_BYTES = 250_000;

const OPTIMIZED_MIME = new Set(["image/jpeg", "image/webp"]);

export type OptimizedPlantImage = {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  skipped: boolean;
};

export function shouldSkipPlantImageOptimize(input: {
  bytes: number;
  mimeType: string;
  width?: number;
  height?: number;
}): boolean {
  if (input.mimeType === "image/gif") return true;
  if (!OPTIMIZED_MIME.has(input.mimeType)) return false;
  if (input.bytes > PLANT_IMAGE_SKIP_MAX_BYTES) return false;
  const edge = Math.max(input.width ?? 0, input.height ?? 0);
  if (edge > PLANT_IMAGE_MAX_EDGE) return false;
  return true;
}

export async function optimizePlantImage(
  input: Buffer,
  sourceMime: string,
): Promise<OptimizedPlantImage> {
  if (sourceMime === "image/gif") {
    const meta = await sharp(input).metadata();
    return {
      data: input,
      mimeType: sourceMime,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      skipped: true,
    };
  }

  const image = sharp(input, { failOn: "none" });
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (
    shouldSkipPlantImageOptimize({
      bytes: input.byteLength,
      mimeType: sourceMime,
      width,
      height,
    })
  ) {
    return { data: input, mimeType: sourceMime, width, height, skipped: true };
  }

  const resized = image.clone().rotate().resize({
    width: PLANT_IMAGE_MAX_EDGE,
    height: PLANT_IMAGE_MAX_EDGE,
    fit: "inside",
    withoutEnlargement: true,
  });

  const useWebp = Boolean(meta.hasAlpha);
  const output = useWebp
    ? await resized.webp({ quality: PLANT_IMAGE_WEBP_QUALITY, effort: 4 }).toBuffer()
    : await resized.jpeg({ quality: PLANT_IMAGE_JPEG_QUALITY, mozjpeg: true }).toBuffer();

  const mimeType = useWebp ? "image/webp" : "image/jpeg";
  const outMeta = await sharp(output).metadata();

  if (output.byteLength >= input.byteLength * 0.9 && sourceMime === mimeType) {
    return { data: input, mimeType: sourceMime, width, height, skipped: true };
  }

  return {
    data: output,
    mimeType,
    width: outMeta.width ?? width,
    height: outMeta.height ?? height,
    skipped: false,
  };
}
