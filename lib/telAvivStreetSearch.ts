import {
  TEL_AVIV_STREET_EN_BY_HE,
  TEL_AVIV_STREETS,
} from "@/constants/telAvivStreets";

const MAX_RESULTS = 50;

export type StreetSearchScript = "he" | "en";

export interface StreetSuggestion {
  /** Hebrew canonical name (stored in orders / validated server-side). */
  value: string;
  /** Label shown in the dropdown for the current search script. */
  label: string;
}

/** First meaningful letter: Hebrew block vs Latin. Digits/punctuation → Hebrew search. */
export function detectStreetSearchScript(query: string): StreetSearchScript {
  const trimmed = query.trim();
  for (const ch of trimmed) {
    if (/[\u0590-\u05FF]/.test(ch)) return "he";
    if (/[A-Za-z]/.test(ch)) return "en";
  }
  return "he";
}

export function filterTelAvivStreetSuggestions(query: string): StreetSuggestion[] {
  const q = query.trim();
  if (!q) return [];

  const script = detectStreetSearchScript(q);
  if (script === "he") {
    return TEL_AVIV_STREETS.filter((street) => street.includes(q))
      .slice(0, MAX_RESULTS)
      .map((street) => ({ value: street, label: street }));
  }

  const qLower = q.toLowerCase();
  const results: StreetSuggestion[] = [];
  for (const he of TEL_AVIV_STREETS) {
    const en = TEL_AVIV_STREET_EN_BY_HE[he];
    if (!en) continue;
    if (!en.toLowerCase().includes(qLower)) continue;
    results.push({ value: he, label: en.toLowerCase() });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}
