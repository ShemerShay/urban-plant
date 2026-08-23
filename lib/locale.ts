export const LOCALES = ["en", "he"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "up_locale";

/** One year. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "he";
}

export function parseLocale(value: string | undefined | null): Locale {
  const v = value?.trim();
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

export function localeHtmlLang(locale: Locale): "en" | "he" {
  return locale;
}

export function localeHtmlDir(locale: Locale): "ltr" | "rtl" {
  return locale === "he" ? "rtl" : "ltr";
}

/** Localized display headings: Noto Sans Hebrew via `font-sans` in HE, Cormorant in EN. */
export function localeDisplayFontClass(locale: Locale): "font-sans" | "font-serif-display" {
  return locale === "he" ? "font-sans" : "font-serif-display";
}
