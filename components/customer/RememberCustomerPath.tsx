"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { rememberGoodCustomerPath } from "@/lib/customerRecovery";

/** Records the current public path after a page successfully renders. */
export function RememberCustomerPath() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) rememberGoodCustomerPath(pathname);
  }, [pathname]);

  return null;
}
