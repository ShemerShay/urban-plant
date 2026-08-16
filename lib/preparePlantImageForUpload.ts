import {
  MAX_PLANT_IMAGE_UPLOAD_BYTES,
  PLANT_IMAGE_BROWSER_MAX_EDGE,
  PLANT_IMAGE_GIF_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_PREPROCESS_FAILED_MESSAGE,
  PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE,
  PlantImageUploadError,
} from "@/lib/plantImageUpload";

const JPEG_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];

function jpegFileName(originalName: string): string {
  const base = originalName.replace(/\.[^/.]+$/, "").trim() || "plant";
  return `${base}.jpg`;
}

async function decodeBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new PlantImageUploadError(PLANT_IMAGE_PREPROCESS_FAILED_MESSAGE));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Resize/compress a plant photo in the browser so the Netlify upload stays under 4 MB.
 * GIFs are left unchanged. JPEG/PNG/WebP are drawn to a 1280px canvas and encoded as JPEG.
 */
export async function preparePlantImageForUpload(file: File, mimeType: string): Promise<File> {
  if (mimeType === "image/gif") {
    if (file.size > MAX_PLANT_IMAGE_UPLOAD_BYTES) {
      throw new PlantImageUploadError(PLANT_IMAGE_GIF_TOO_LARGE_MESSAGE);
    }
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeBitmap(file);
  } catch {
    throw new PlantImageUploadError(PLANT_IMAGE_PREPROCESS_FAILED_MESSAGE);
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = longEdge > PLANT_IMAGE_BROWSER_MAX_EDGE ? PLANT_IMAGE_BROWSER_MAX_EDGE / longEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    if (scale === 1 && file.size <= MAX_PLANT_IMAGE_UPLOAD_BYTES) {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new PlantImageUploadError(PLANT_IMAGE_PREPROCESS_FAILED_MESSAGE);
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (const quality of JPEG_QUALITIES) {
      const blob = await canvasToJpegBlob(canvas, quality);
      if (blob.size <= MAX_PLANT_IMAGE_UPLOAD_BYTES) {
        return new File([blob], jpegFileName(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }

    throw new PlantImageUploadError(PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE);
  } finally {
    bitmap.close();
  }
}
