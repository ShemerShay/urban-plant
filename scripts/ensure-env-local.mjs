/**
 * One-time: create .env.local from .env.example if missing (does not overwrite).
 * Run: npm run setup:env
 */
import { copyFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, ".env.local");
const source = path.join(root, ".env.example");

try {
  await access(target, constants.F_OK);
  console.log(".env.local already exists — leaving it unchanged.");
  console.log("Set RESEND_API_KEY, RESEND_FROM, ADMIN_PASSWORD, and NEXT_PUBLIC_WHATSAPP_PHONE in .env.local as needed.");
} catch {
  await copyFile(source, target);
  console.log("Created .env.local from .env.example");
  console.log("Next: open .env.local, set RESEND_API_KEY=re_..., then run npm run dev");
}
