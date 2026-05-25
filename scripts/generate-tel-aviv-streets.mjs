import fs from "fs";
import https from "https";

const streetsUrl = "https://gisn.tel-aviv.gov.il/GisOpenData/service.asmx/GetStreets";
const englishLayerQueryBase =
  "https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/850/query?where=1%3D1&outFields=shem_angli,t_rechov&returnGeometry=false&f=json&resultRecordCount=2000";

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

async function fetchHebrewToEnglishMap() {
  const map = new Map();
  let offset = 0;
  while (true) {
    const url = `${englishLayerQueryBase}&resultOffset=${offset}`;
    const json = await fetchJson(url);
    for (const feature of json.features ?? []) {
      const he = feature.attributes?.t_rechov?.trim();
      const en = feature.attributes?.shem_angli?.trim();
      if (he && en && !map.has(he)) {
        map.set(he, en);
      }
    }
    if (!json.exceededTransferLimit) break;
    offset += (json.features ?? []).length;
  }
  return map;
}

const json = await fetchJson(streetsUrl);
const names = Object.values(json)
  .map((v) => String(v).trim())
  .filter(isStreetName);
const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b, "he"));

const heToEnFromGis = await fetchHebrewToEnglishMap();
const enByHe = {};
let withEnglish = 0;
for (const he of unique) {
  const en = heToEnFromGis.get(he);
  if (en) {
    enByHe[he] = en;
    withEnglish += 1;
  }
}

const out = `/**
 * Tel Aviv street names from municipal open data (Hebrew + English transliteration).
 * Regenerate: npm run generate:tel-aviv-streets
 */
export const TEL_AVIV_CITY = "Tel Aviv" as const;

export const TEL_AVIV_STREETS: readonly string[] = ${JSON.stringify(unique, null, 2)} as const;

/** Official Latin transliteration per Hebrew street (ArcGIS layer 850). */
export const TEL_AVIV_STREET_EN_BY_HE: Readonly<Record<string, string>> = ${JSON.stringify(enByHe, null, 2)} as const;

export const TEL_AVIV_STREET_SET = new Set<string>(TEL_AVIV_STREETS);
`;

fs.mkdirSync("constants", { recursive: true });
fs.writeFileSync("constants/telAvivStreets.ts", out);
console.log(
  `Wrote ${unique.length} streets (${withEnglish} with English) to constants/telAvivStreets.ts`,
);
