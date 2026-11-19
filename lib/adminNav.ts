import type { MessageKey } from "@/lib/messages";
import { routes } from "@/lib/routes";

export interface AdminNavItem {
  href: string;
  label: MessageKey;
}

/**
 * Shared navigation for admin surfaces that exist today. Inventory balances are
 * intentionally added only after the inventory schema slice creates that page.
 */
export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: routes.admin.analytics(), label: "admin.home.analytics" },
  { href: routes.admin.finance(), label: "admin.nav.finance" },
  { href: routes.admin.orders(), label: "admin.home.orders" },
  { href: routes.admin.inventoryTypes(), label: "admin.nav.catalog" },
  { href: routes.admin.offers(), label: "admin.home.offers" },
  { href: routes.admin.partners(), label: "admin.nav.partnersPos" },
] as const;

export function isAdminNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
