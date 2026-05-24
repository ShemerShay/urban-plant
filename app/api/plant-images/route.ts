import { NextRequest, NextResponse } from "next/server";

import { listPlantLibraryImages, savePlantLibraryImage } from "@/lib/plantImageStorage";
import { readPlants } from "@/lib/plantStorage";

function isLocalLibraryUrl(url: string): boolean {
  return url.startsWith("/plant-library/");
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
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing "file" field' }, { status: 400 });
  }

  const mimeType = file.type || "application/octet-stream";
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const saved = await savePlantLibraryImage(buffer, mimeType, file.name || "plant");
    return NextResponse.json({ image: saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    const status = message.includes("must be") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
