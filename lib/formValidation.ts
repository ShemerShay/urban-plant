const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Basic email shape check (not exhaustive RFC validation). */
export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** Digits-only length 7–15; allows +, spaces, dashes, and parentheses. */
export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/^[+]?[\d\s().-]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

const ISRAELI_MOBILE_PREFIX = "05";
const ISRAELI_MOBILE_LENGTH = 10;

/** Checkout: Israeli mobile — 10 digits starting with 05 (e.g. 0521234567). */
export function isValidIsraeliMobilePhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  return digits.length === ISRAELI_MOBILE_LENGTH && digits.startsWith(ISRAELI_MOBILE_PREFIX);
}

/** Checkout input: digits only, locked 05 prefix, max 10 digits. */
export function normalizeIsraeliMobilePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= ISRAELI_MOBILE_PREFIX.length) {
    return ISRAELI_MOBILE_PREFIX;
  }
  if (!digits.startsWith(ISRAELI_MOBILE_PREFIX)) {
    const rest = digits.startsWith("5") ? digits.slice(1) : digits;
    return (ISRAELI_MOBILE_PREFIX + rest).slice(0, ISRAELI_MOBILE_LENGTH);
  }
  return digits.slice(0, ISRAELI_MOBILE_LENGTH);
}
