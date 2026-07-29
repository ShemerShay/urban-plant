import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/**
 * Legacy Create POS Spot / QR page — creation now lives on each Partner page.
 * QR tooling is reused inside Partner → POS Spots → Add.
 */
export default function AdminQrRedirectPage() {
  redirect(routes.admin.partners());
}
