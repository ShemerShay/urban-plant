import { sql } from "@/lib/db";
import type { PlantLibraryImage } from "@/lib/plantImageStorage";
import { routes } from "@/lib/routes";

type PlantLibraryRow = {
  filename: string;
  mime_type: string;
  data: Uint8Array | Buffer | string;
  uploaded_at: string | Date;
};

function rowToBuffer(data: PlantLibraryRow["data"]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === "string") {
    if (/^[0-9a-f]+$/i.test(data) && data.length % 2 === 0) {
      return Buffer.from(data, "hex");
    }
    return Buffer.from(data, "base64");
  }
  return Buffer.from(data as ArrayBuffer);
}

export async function listPlantLibraryImagesFromDb(): Promise<PlantLibraryImage[]> {
  const rows = (await sql`
    SELECT filename, uploaded_at
    FROM plant_library_images
    ORDER BY uploaded_at DESC
  `) as Pick<PlantLibraryRow, "filename" | "uploaded_at">[];

  return rows.map((row) => ({
    url: routes.plantLibrary(row.filename),
    filename: row.filename,
    uploadedAt:
      row.uploaded_at instanceof Date
        ? row.uploaded_at.toISOString()
        : String(row.uploaded_at),
  }));
}

export async function savePlantLibraryImageToDb(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<PlantLibraryImage> {
  const uploadedAt = new Date().toISOString();
  await sql`
    INSERT INTO plant_library_images (filename, mime_type, data, uploaded_at)
    VALUES (${filename}, ${mimeType}, ${buffer}, ${uploadedAt})
    ON CONFLICT (filename) DO UPDATE
    SET mime_type = EXCLUDED.mime_type,
        data = EXCLUDED.data,
        uploaded_at = EXCLUDED.uploaded_at
  `;

  return {
    url: routes.plantLibrary(filename),
    filename,
    uploadedAt,
  };
}

export async function getPlantLibraryImageFromDb(
  filename: string,
): Promise<{ mimeType: string; data: Buffer } | null> {
  const rows = (await sql`
    SELECT mime_type, data
    FROM plant_library_images
    WHERE filename = ${filename}
    LIMIT 1
  `) as Pick<PlantLibraryRow, "mime_type" | "data">[];

  const row = rows[0];
  if (!row) return null;
  return { mimeType: row.mime_type, data: rowToBuffer(row.data) };
}
