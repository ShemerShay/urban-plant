/**
 * Business WhatsApp for customer contact (wa.me expects digits only, country code, no +).
 * Set NEXT_PUBLIC_WHATSAPP_PHONE in env, e.g. 972501234567
 */
export function getWhatsAppBusinessDigits(): string {
  return (process.env.NEXT_PUBLIC_WHATSAPP_PHONE ?? "").replace(/\D/g, "");
}

export function buildWhatsAppChatUrl(message?: string): string {
  const phone = getWhatsAppBusinessDigits();
  if (!message?.trim()) return `https://wa.me/${phone}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message.trim())}`;
}
