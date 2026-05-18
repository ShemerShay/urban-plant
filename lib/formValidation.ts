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
