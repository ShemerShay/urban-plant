import { AdminSignOut } from "@/components/admin/AdminSignOut";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <div className="fixed bottom-5 right-5 z-50">
        <AdminSignOut />
      </div>
    </>
  );
}
