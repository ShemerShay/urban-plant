import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

interface PageProps {
  searchParams: Promise<{ partner?: string }>;
}

/**
 * Legacy global POS Spots page — redirects into Partners (or a specific partner when
 * `?partner=` is present).
 */
export default async function AdminPosSpotsRedirectPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const partnerId = typeof params.partner === "string" ? params.partner.trim() : "";
  if (partnerId) {
    redirect(routes.admin.partner(partnerId));
  }
  redirect(routes.admin.partners());
}
