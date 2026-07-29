import { AdminPartnerDetail } from "@/components/admin/AdminPartnerDetail";

interface PageProps {
  params: Promise<{ partnerId: string }>;
}

export default async function AdminPartnerDetailPage({ params }: PageProps) {
  const { partnerId: rawId } = await params;
  const partnerId = decodeURIComponent(rawId);

  return (
    <main
      id="admin-partner-detail-page"
      className="mx-auto min-h-screen w-full max-w-md px-4 py-6 pb-12"
    >
      <AdminPartnerDetail partnerId={partnerId} />
    </main>
  );
}
