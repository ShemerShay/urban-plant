import { AdminPotsManager } from "@/components/admin/AdminPotsManager";
import { readPots } from "@/lib/potStorage";

export default async function AdminPotsPage() {
  const pots = await readPots();
  return (
    <main id="admin-pots-page" className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12">
      <AdminPotsManager initialPots={pots} />
    </main>
  );
}
