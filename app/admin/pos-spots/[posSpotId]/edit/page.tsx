import { AdminPosSpotEditForm } from "@/components/admin/AdminPosSpotEditForm";

/**
 * Dedicated edit screen: the POS list uses a narrow `max-w-md` column and each card
 * already stacks QR, metadata, URL, and actions — inlining ~6 inputs would crowd taps
 * and small screens, so edits live here with the same form density as `/admin/qr`.
 */
export default async function AdminPosSpotEditPage({
  params,
}: {
  params: Promise<{ posSpotId: string }>;
}) {
  const { posSpotId } = await params;
  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12">
      <AdminPosSpotEditForm posSpotId={decodeURIComponent(posSpotId)} />
    </main>
  );
}
