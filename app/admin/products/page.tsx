import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

export default function AdminProductsRedirectPage() {
  redirect(routes.admin.inventoryTypes());
}
