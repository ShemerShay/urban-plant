/**
 * Customer-facing recovery helpers for dead ends (404 / missing public resources).
 * Remembers the last successfully viewed public page in sessionStorage so return
 * never invents a plant URL or sends users into admin.
 */

import { isSafeCustomerReturnPath } from "@/lib/routes";
import { buildWhatsAppChatUrl } from "@/lib/whatsappContact";

export const LAST_GOOD_CUSTOMER_PATH_KEY = "urban-plant:last-good-customer-path";

export const CUSTOMER_RECOVERY_WHATSAPP_MESSAGE =
  "Hi Urban Plant — I opened a plant page that didn’t load (broken link or QR). Can you help?";

export function rememberGoodCustomerPath(pathname: string): void {
  if (typeof window === "undefined") return;
  const path = pathname.split("?")[0] ?? "";
  if (!isSafeCustomerReturnPath(path)) return;
  try {
    sessionStorage.setItem(LAST_GOOD_CUSTOMER_PATH_KEY, path);
  } catch {
    // private mode / blocked storage — recovery falls back to WhatsApp only
  }
}

export function readRememberedCustomerPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = sessionStorage.getItem(LAST_GOOD_CUSTOMER_PATH_KEY);
    if (!stored) return null;
    return isSafeCustomerReturnPath(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Pick a safe return path that is not the current broken URL.
 * Prefers a successfully remembered plant/checkout page, then same-origin referrer
 * if it looks like a safe customer path.
 */
export function resolveSafeReturnPath(currentPathname: string): string | null {
  const current = (currentPathname.split("?")[0] ?? "").trim() || "/";

  const remembered = readRememberedCustomerPath();
  if (remembered && remembered !== current) {
    return remembered;
  }

  if (typeof document !== "undefined" && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === window.location.origin) {
        const refPath = ref.pathname;
        if (isSafeCustomerReturnPath(refPath) && refPath !== current) {
          return refPath;
        }
      }
    } catch {
      // ignore malformed referrer
    }
  }

  return null;
}

export function customerRecoveryWhatsAppUrl(message?: string): string {
  return buildWhatsAppChatUrl(message ?? CUSTOMER_RECOVERY_WHATSAPP_MESSAGE);
}
