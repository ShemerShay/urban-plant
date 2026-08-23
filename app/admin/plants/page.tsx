import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

export default function AdminPlantsRedirectPage() {
  redirect(routes.admin.productsPlants());
}
