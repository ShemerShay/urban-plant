import fs from "fs";
import https from "https";

const url = "https://gisn.tel-aviv.gov.il/GisOpenData/service.asmx/GetStreets";

function fetchJson(targetUrl) {
  return new Promise((resolve, reject) => {
    https
      .get(targetUrl, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

function isStreetName(name) {
  if (!name || name.length < 2) return false;
  if (/^\d+$/.test(name)) return false;
  if (/^\d{3,4}$/.test(name)) return false;
  if (/^(ת"א -|כניסה|חניון|כ\.מ|י\.מ|כביש |רכבת |מתחם |גישה-|600\d|610\d|620\d|650\d|730\d|500\d|520\d|550\d)/.test(name)) {
    return false;
  }
  return true;
}

const json = await fetchJson(url);
const names = Object.values(json)
  .map((v) => String(v).trim())
  .filter(isStreetName);
const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b, "he"));

const out = `/**
 * Tel Aviv street names (Hebrew) from municipal open data.
 * Regenerate: node scripts/generate-tel-aviv-streets.mjs
 */
export const TEL_AVIV_CITY = "Tel Aviv" as const;

export const TEL_AVIV_STREETS: readonly string[] = ${JSON.stringify(unique, null, 2)} as const;

export const TEL_AVIV_STREET_SET = new Set<string>(TEL_AVIV_STREETS);
`;

fs.mkdirSync("constants", { recursive: true });
fs.writeFileSync("constants/telAvivStreets.ts", out);
console.log(`Wrote ${unique.length} streets to constants/telAvivStreets.ts`);
