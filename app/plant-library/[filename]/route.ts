import { NextResponse } from "next/server";

import { getPlantLibraryImageBytes, isSafePlantLibraryFilename } from "@/lib/plantImageStorage";

interface RouteParams {
  params: Promise<{ filename: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { filename: raw } = await params;
  const filename = decodeURIComponent(raw);

  if (!isSafePlantLibraryFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const image = await getPlantLibraryImageBytes(filename);
  if (!image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
