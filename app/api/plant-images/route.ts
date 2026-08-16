import { NextRequest, NextResponse } from "next/server";

import { listPlantLibraryImages, savePlantLibraryImage } from "@/lib/plantImageStorage";
import {
  MAX_PLANT_IMAGE_UPLOAD_BYTES,
  PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE,
  PLANT_IMAGE_UNPROCESSABLE_MESSAGE,
  PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE,
  PlantImageUploadError,
} from "@/lib/plantImageUpload";
import { readPlants } from "@/lib/plantStorage";

function isLocalLibraryUrl(url: string): boolean {
  return url.startsWith("/plant-library/");
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const [libraryFiles, plants] = await Promise.all([listPlantLibraryImages(), readPlants()]);

  const urlSet = new Set(libraryFiles.map((item) => item.url));
  const fromCatalog: { url: string; filename: string }[] = [];

  for (const plant of plants) {
    for (const url of plant.images) {
      if (!url.trim() || urlSet.has(url) || fromCatalog.some((item) => item.url === url)) {
        continue;
      }
      urlSet.add(url);
      fromCatalog.push({
        url,
        filename: isLocalLibraryUrl(url) ? url.replace("/plant-library/", "") : url,
      });
    }
  }

  return NextResponse.json({
    images: [...libraryFiles, ...fromCatalog],
  });
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PLANT_IMAGE_UPLOAD_BYTES + 65_536) {
    return jsonError(PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE, 400);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(PLANT_IMAGE_PROCESSED_TOO_LARGE_MESSAGE, 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError(PLANT_IMAGE_UNSUPPORTED_TYPE_MESSAGE, 400);
  }

  const mimeType = file.type || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const saved = await savePlantLibraryImage(buffer, mimeType, file.name || "plant");
    return NextResponse.json({ image: saved }, { status: 201 });
  } catch (error) {
    if (error instanceof PlantImageUploadError) {
      return jsonError(error.message, 400);
    }
    return jsonError(PLANT_IMAGE_UNPROCESSABLE_MESSAGE, 500);
  }
}
