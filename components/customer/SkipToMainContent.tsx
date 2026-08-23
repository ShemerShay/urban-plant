"use client";

import { usePathname } from "next/navigation";

import { useLocale } from "@/components/locale/LocaleProvider";
import { t } from "@/lib/messages";

/** Skip link for customer-facing routes only (not admin). */
export function SkipToMainContent() {
  const pathname = usePathname() ?? "";
  const locale = useLocale();
  if (pathname.startsWith("/admin") || pathname.startsWith("/admin-login")) {
    return null;
  }

  return (
    <a href="#main-content" className="skip-link">
      {t(locale, "common.skipToContent")}
    </a>
  );
}
