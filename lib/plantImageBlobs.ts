import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getStore } from "@netlify/blobs";

/** Site-wide store. Do not use getDeployStore — uploads must survive redeploy. */
export const PLANT_LIBRARY_BLOB_STORE = "plant-library";

const SAFE_BLOB_KEY = /^[a-z0-9][a-z0-9-]*\.(jpg|jpeg|png|webp|gif)$/i;

/**
 * Local stand-in used by `next dev` / `next start`.
 * Netlify injects blob credentials in production; this directory is never deployed.
 */
const LOCAL_BLOB_DIR = path.join(process.cwd(), ".netlify", "plant-library-blobs");

/**
 * New blob keys are readable immediately under the default eventual model.
 * Strong consistency is only required for overwrite/delete propagation, and
 * upload keys are unique, so reads stay on the fast default.
 */
export function usesNetlifyBlobStore(): boolean {
  return process.env.NETLIFY === "true" || Boolean(process.env.NETLIFY_BLOBS_CONTEXT);
}

function assertBlobKey(filename: string): void {
  if (path.basename(filename) !== filename || !SAFE_BLOB_KEY.test(filename)) {
    throw new Error("Invalid plant library filename");
  }
}

function localBlobPath(filename: string): string {
  assertBlobKey(filename);
  return path.join(LOCAL_BLOB_DIR, filename);
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function readPlantLibraryBlob(filename: string): Promise<Buffer | null> {
  assertBlobKey(filename);
  if (usesNetlifyBlobStore()) {
    const data = await getStore(PLANT_LIBRARY_BLOB_STORE).get(filename, { type: "arrayBuffer" });
    return data ? Buffer.from(data) : null;
  }
  try {
    return await readFile(localBlobPath(filename));
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

export async function writePlantLibraryBlob(filename: string, bytes: Buffer): Promise<void> {
  assertBlobKey(filename);
  if (usesNetlifyBlobStore()) {
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    await getStore(PLANT_LIBRARY_BLOB_STORE).set(filename, body);
    return;
  }
  await mkdir(LOCAL_BLOB_DIR, { recursive: true });
  await writeFile(localBlobPath(filename), bytes);
}

export async function deletePlantLibraryBlob(filename: string): Promise<void> {
  assertBlobKey(filename);
  if (usesNetlifyBlobStore()) {
    await getStore(PLANT_LIBRARY_BLOB_STORE).delete(filename);
    return;
  }
  await rm(localBlobPath(filename), { force: true });
}
