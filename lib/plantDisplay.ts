import type { Locale } from "@/lib/locale";

/** Customer UI: Hebrew when locale is HE and the Hebrew value is non-empty; otherwise English. */
export function localizedPlantText(
  locale: Locale,
  english: string,
  hebrew?: string | null,
): string {
  if (locale === "he") {
    const he = hebrew?.trim();
    if (he) return he;
  }
  return english;
}
