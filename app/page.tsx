import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

/** `/` → admin (middleware sends unauthenticated users to login). */
export default function Home() {
  redirect(routes.admin.index());
}
