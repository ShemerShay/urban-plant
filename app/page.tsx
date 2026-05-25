import { redirect } from "next/navigation";

import { DEFAULT_POS_SPOT_SLUG, posSpotPath } from "@/lib/qrNavigation";

/** `/` → default POS plant page (keeps a real App Router page for Turbopack HMR). */
export default function Home() {
  redirect(posSpotPath(DEFAULT_POS_SPOT_SLUG));
}
