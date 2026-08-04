/**
 * One-off export: 80 transparent PNG QR codes + Excel workbook for Alon Shabo - Chlenov.
 * Does not modify application runtime QR UI.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import QRCode from "qrcode";
import { PNG } from "pngjs";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = "https://urban-plant-beherha.netlify.app";
const COUNT = 80;
const PNG_SIZE = 1024;
const QUIET_ZONE_MODULES = 4;
const EXPORT_ROOT = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  "Desktop",
  "Urban plant QR's",
);
const PNG_DIR = path.join(EXPORT_ROOT, "png");
const XLSX_PATH = path.join(EXPORT_ROOT, "alon_shabo_chlenov_qr_spots_80.xlsx");
const REPORT_PATH = path.join(EXPORT_ROOT, "generation-report.txt");

function slugFor(n) {
  return `alon_shabo_chlenov_${n}`;
}

function urlFor(n) {
  return `${BASE_URL}/pos/${slugFor(n)}`;
}

function pngPathFor(n) {
  return path.join(PNG_DIR, `${slugFor(n)}.png`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pngHasAlpha(filePath) {
  const buf = fs.readFileSync(filePath);
  // IHDR: width(4) height(4) bitDepth(1) colorType(1) — colorType 4 or 6 includes alpha
  const colorType = buf[25];
  if (colorType !== 4 && colorType !== 6) return false;

  const png = PNG.sync.read(buf);
  let transparentPixels = 0;
  let opaqueBlack = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a === 0) transparentPixels += 1;
    if (a === 255 && r === 0 && g === 0 && b === 0) opaqueBlack += 1;
  }
  return {
    colorType,
    width: png.width,
    height: png.height,
    transparentPixels,
    opaqueBlack,
    hasRealAlpha: transparentPixels > 0 && opaqueBlack > 0,
  };
}

async function generatePng(n) {
  const url = urlFor(n);
  const out = pngPathFor(n);
  await QRCode.toFile(out, url, {
    type: "png",
    width: PNG_SIZE,
    margin: QUIET_ZONE_MODULES,
    errorCorrectionLevel: "M",
    color: {
      dark: "#000000",
      light: "#00000000",
    },
  });
  return { n, url, out };
}

async function decodeQr(filePath) {
  let jsQR;
  try {
    jsQR = (await import("jsqr")).default;
  } catch {
    return { ok: false, error: "jsQR not installed" };
  }
  const png = PNG.sync.read(fs.readFileSync(filePath));
  // jsQR needs non-transparent contrast; composite onto white for decode-only
  const rgba = Buffer.alloc(png.width * png.height * 4);
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    rgba[i] = Math.round(png.data[i] * a + 255 * (1 - a));
    rgba[i + 1] = Math.round(png.data[i + 1] * a + 255 * (1 - a));
    rgba[i + 2] = Math.round(png.data[i + 2] * a + 255 * (1 - a));
    rgba[i + 3] = 255;
  }
  const result = jsQR(new Uint8ClampedArray(rgba), png.width, png.height);
  if (!result) return { ok: false, error: "decode failed" };
  return { ok: true, data: result.data };
}

async function buildWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "urban-plant";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("QR Spots", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.getColumn(1).header = "id num";
  sheet.getColumn(2).header = "qr";
  sheet.getRow(1).values = ["id num", "qr"];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 22;

  // ~180px square display; Excel column width ≈ pixels/7
  const qrColWidth = 28;
  const rowHeightPx = 180;
  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = qrColWidth;
  sheet.getColumn(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.getColumn(2).alignment = { vertical: "middle", horizontal: "center" };

  for (let n = 1; n <= COUNT; n += 1) {
    const rowIndex = n + 1;
    const row = sheet.getRow(rowIndex);
    row.getCell(1).value = n;
    row.height = rowHeightPx * 0.75; // Excel row height is in points (~0.75 px)

    const imageId = workbook.addImage({
      filename: pngPathFor(n),
      extension: "png",
    });

    // Place image fully inside column B cell with small padding, preserving square aspect
    const col = 1; // 0-based: column B
    const padding = 0.08;
    sheet.addImage(imageId, {
      tl: { col: col + padding, row: rowIndex - 1 + padding },
      br: { col: col + 1 - padding, row: rowIndex - padding },
      editAs: "oneCell",
    });
  }

  await workbook.xlsx.writeFile(XLSX_PATH);
}

function cleanupObsoleteExports() {
  const removed = [];
  if (!fs.existsSync(EXPORT_ROOT)) return removed;

  for (const name of fs.readdirSync(EXPORT_ROOT)) {
    const full = path.join(EXPORT_ROOT, name);
    const lower = name.toLowerCase();
    const isSheinkin =
      lower.includes("sheinkin") || lower.includes("shenkin");
    const isOldSvg = lower.endsWith(".svg");
    const isOldZip = lower.endsWith(".zip");
    const isOldXlsx =
      lower.endsWith(".xlsx") && !lower.includes("alon_shabo_chlenov_qr_spots_80");
    if (isSheinkin || isOldSvg || isOldZip || (isOldXlsx && lower.includes("sheinkin"))) {
      fs.rmSync(full, { force: true, recursive: true });
      removed.push(full);
    }
  }

  // Remove leftover root-level Chlenov SVGs after PNG set exists
  for (const name of fs.readdirSync(EXPORT_ROOT)) {
    const full = path.join(EXPORT_ROOT, name);
    if (
      /^alon_shabo_chlenov_\d+\.svg$/i.test(name) ||
      /^urban-plant-qrs\.zip$/i.test(name)
    ) {
      fs.rmSync(full, { force: true });
      removed.push(full);
    }
  }
  return removed;
}

async function fetchStatus(url) {
  try {
    const res = await fetch(url, { redirect: "manual" });
    return {
      url,
      status: res.status,
      location: res.headers.get("location"),
      redirected: res.status >= 300 && res.status < 400,
    };
  } catch (err) {
    return { url, error: String(err) };
  }
}

async function main() {
  ensureDir(PNG_DIR);

  console.log("Generating 80 transparent PNG QR codes…");
  const generated = [];
  for (let n = 1; n <= COUNT; n += 1) {
    generated.push(await generatePng(n));
    if (n % 10 === 0) console.log(`  ${n}/${COUNT}`);
  }

  console.log("Validating PNG alpha…");
  const alphaChecks = [1, 15, 16, 40, 80].map((n) => ({
    n,
    ...pngHasAlpha(pngPathFor(n)),
  }));
  for (const check of alphaChecks) {
    if (!check.hasRealAlpha) {
      throw new Error(`PNG ${check.n} missing real alpha transparency`);
    }
    if (check.width !== check.height) {
      throw new Error(`PNG ${check.n} is not square (${check.width}x${check.height})`);
    }
  }

  console.log("Decoding sample QRs…");
  // Ensure jsQR available
  try {
    require.resolve("jsqr");
  } catch {
    const { execSync } = await import("node:child_process");
    execSync("npm install jsqr --no-save", { stdio: "inherit", cwd: path.join(__dirname, "..") });
  }

  const sampleNums = [1, 15, 16, 40, 80];
  const decodeResults = [];
  for (const n of sampleNums) {
    const decoded = await decodeQr(pngPathFor(n));
    const expected = urlFor(n);
    if (!decoded.ok || decoded.data !== expected) {
      throw new Error(
        `QR decode mismatch for ${n}: got ${decoded.data ?? decoded.error}, expected ${expected}`,
      );
    }
    decodeResults.push({ n, data: decoded.data });
    console.log(`  scanned ${n}: OK`);
  }

  console.log("Building Excel workbook…");
  await buildWorkbook();

  console.log("Checking production URLs…");
  const urlChecks = [];
  for (const n of sampleNums) {
    const check = await fetchStatus(urlFor(n));
    if (check.error || check.status !== 200) {
      throw new Error(`URL check failed for ${n}: ${JSON.stringify(check)}`);
    }
    if (check.redirected && check.location && /admin|login/i.test(check.location)) {
      throw new Error(`URL ${n} redirected to admin/login: ${check.location}`);
    }
    urlChecks.push(check);
    console.log(`  ${urlFor(n)} -> ${check.status}`);
  }

  // Also confirm a Sheinkin slug now 404s
  const sheinkinGone = await fetchStatus(`${BASE_URL}/pos/alon_shabo_sheinkin_1`);
  console.log(`  sheinkin_1 -> ${sheinkinGone.status}`);

  console.log("Cleaning obsolete exports…");
  const removed = cleanupObsoleteExports();

  const pngFiles = fs
    .readdirSync(PNG_DIR)
    .filter((f) => /^alon_shabo_chlenov_\d+\.png$/i.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/_(\d+)\.png$/i)?.[1] || 0);
      const nb = Number(b.match(/_(\d+)\.png$/i)?.[1] || 0);
      return na - nb;
    });

  if (pngFiles.length !== COUNT) {
    throw new Error(`Expected ${COUNT} PNGs, found ${pngFiles.length}`);
  }
  for (let n = 1; n <= COUNT; n += 1) {
    if (!pngFiles.includes(`${slugFor(n)}.png`)) {
      throw new Error(`Missing PNG for spot ${n}`);
    }
  }

  const urls = generated.map((g) => g.url);
  if (new Set(urls).size !== COUNT) {
    throw new Error("Duplicate QR URLs detected");
  }

  const report = [
    "Alon Shabo - Chlenov QR export report",
    `Generated at: ${new Date().toISOString()}`,
    "",
    `Output directory: ${EXPORT_ROOT}`,
    `PNG directory: ${PNG_DIR}`,
    `Excel workbook: ${XLSX_PATH}`,
    "",
    "Database approach: preserved Chlenov spots 1–15; inserted 16–80; deleted all Sheinkin POS spots.",
    "Sheinkin partner row retained.",
    "",
    `Chlenov spots: ${COUNT} (numbers 1–80)`,
    `Encoded URL format: ${BASE_URL}/pos/{spotSlug}`,
    `Example: ${urlFor(1)}`,
    "",
    `PNG count: ${pngFiles.length}`,
    `PNG size: ${PNG_SIZE}x${PNG_SIZE} px`,
    `Quiet zone: ${QUIET_ZONE_MODULES} modules (transparent)`,
    "PNG transparency: RGBA with light modules alpha=0, dark modules #000000",
    "",
    "Sample alpha checks:",
    ...alphaChecks.map(
      (c) =>
        `  #${c.n}: colorType=${c.colorType} transparentPixels=${c.transparentPixels} opaqueBlack=${c.opaqueBlack} square=${c.width}x${c.height}`,
    ),
    "",
    "Sample QR decode:",
    ...decodeResults.map((d) => `  #${d.n}: ${d.data}`),
    "",
    "Sample HTTP checks:",
    ...urlChecks.map((u) => `  ${u.url} -> ${u.status}`),
    `  Sheinkin spot 1 after delete: ${sheinkinGone.status}`,
    "",
    "Removed obsolete files:",
    ...(removed.length ? removed.map((r) => `  ${r}`) : ["  (none)"]),
    "",
    "Validation: PASSED",
  ].join("\n");

  fs.writeFileSync(REPORT_PATH, report, "utf8");
  console.log("\nDone.");
  console.log(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
