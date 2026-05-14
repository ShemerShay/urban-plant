/**
 * Business WhatsApp for customer contact (wa.me expects digits only, country code, no +).
 * Set NEXT_PUBLIC_WHATSAPP_PHONE to override (e.g. 972546605603 or 0546605603).
 */

/** Default Urban Plant line (054-660-5603) when env is unset. */
const DEFAULT_WHATSAPP_DIGITS = "972546605603";

const IL_PREFIX = "972";

function normalizePhoneDigits(input: string): string {
  const d = input.replace(/\D/g, "");
  if (!d) return "";

  if (d.startsWith(IL_PREFIX)) return d;

  // Israeli mobile: 05XXXXXXXX (10 digits) → 972 + 9 digits
  if (d.startsWith("0") && d.length === 10 && d[1] === "5") {
    return IL_PREFIX + d.slice(1);
  }

  // Israeli mobile without leading 0: 5XXXXXXXX (9 digits)
  if (d.startsWith("5") && d.length === 9) {
    return IL_PREFIX + d;
  }

  return d;
}

export function getWhatsAppBusinessDigits(): string {
  const fromEnv = normalizePhoneDigits(process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "");
  if (fromEnv) return fromEnv;
  return DEFAULT_WHATSAPP_DIGITS;
}

export function buildWhatsAppChatUrl(message?: string): string {
  const phone = getWhatsAppBusinessDigits();
  if (!phone) return "";
  if (!message?.trim()) return `https://wa.me/${phone}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message.trim())}`;
}
