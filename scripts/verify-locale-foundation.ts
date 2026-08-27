/**
 * Locale foundation checks (cookie + html attrs + switcher wiring).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  localeDisplayFontClass,
  localeHtmlDir,
  localeHtmlLang,
  parseLocale,
} from "../lib/locale";

assert.equal(DEFAULT_LOCALE, "en");
assert.equal(parseLocale(undefined), "en");
assert.equal(parseLocale("nope"), "en");
assert.equal(parseLocale("he"), "he");
assert.equal(localeHtmlLang("en"), "en");
assert.equal(localeHtmlDir("en"), "ltr");
assert.equal(localeHtmlLang("he"), "he");
assert.equal(localeHtmlDir("he"), "rtl");
assert.equal(LOCALE_COOKIE, "up_locale");
assert.equal(localeDisplayFontClass("he"), "font-sans");
assert.equal(localeDisplayFontClass("en"), "font-serif-display");

const root = process.cwd();
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const layout = read("app/layout.tsx");
assert.match(layout, /lang=\{localeHtmlLang\(locale\)\}/);
assert.match(layout, /dir=\{localeHtmlDir\(locale\)\}/);
assert.match(layout, /LocaleProvider/);
assert.match(layout, /Noto_Sans_Hebrew/);
assert.match(layout, /notoSansHebrew\.variable/);

const globals = read("app/globals.css");
assert.match(globals, /font-family:\s*var\(--font-sans\)/);
assert.match(globals, /html\[lang="he"\] \{\s*--font-sans:\s*var\(--font-noto-sans-hebrew\);\s*\}/);
assert.match(globals, /\.font-serif-display[\s\S]*--font-cormorant/);

const header = read("components/plant/PlantPageHeader.tsx");
assert.match(header, /dir="ltr"/);
assert.match(header, /flex-row-reverse/);
assert.match(header, /items-start/);
assert.match(header, /font-serif-display/);
assert.match(header, /UrbanPlant/);
const switcherIdx = header.indexOf("<LanguageSwitcher");
const locationIdx = header.indexOf("{knownPartner ?");
assert.ok(switcherIdx > 0 && locationIdx > switcherIdx);

const nextConfig = read("next.config.ts");
assert.match(nextConfig, /source:\s*"\/pos\/:spotSlug"/);
assert.match(nextConfig, /destination:\s*"\/checkout\/pos\/:spotSlug"/);

const checkout = read("app/checkout/pos/[spotSlug]/page.tsx");
assert.match(checkout, /<PlantPageHeader knownPartner=/);

const login = read("app/admin-login/AdminLoginForm.tsx");
assert.match(login, /LanguageSwitcher/);
assert.match(login, /localeDisplayFontClass/);

const adminLayout = read("app/admin/layout.tsx");
assert.match(adminLayout, /LanguageSwitcher/);

const api = read("app/api/locale/route.ts");
assert.match(api, /LOCALE_COOKIE/);
assert.doesNotMatch(api, /feature\/hebrew-ui/);

console.log("OK: locale foundation wiring verified");
