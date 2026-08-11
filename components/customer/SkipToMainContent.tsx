"use client";

import { usePathname } from "next/navigation";

/** Skip link for customer-facing routes only (not admin). */
export function SkipToMainContent() {
  const pathname = usePathname() ?? "";
  if (pathname.startsWith("/admin") || pathname.startsWith("/admin-login")) {
    return null;
  }

  return (
    <a href="#main-content" className="skip-link">
      Skip to main content
    </a>
  );
}
