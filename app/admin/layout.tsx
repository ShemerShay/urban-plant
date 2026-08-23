import { AdminSignOut } from "@/components/admin/AdminSignOut";
import { LanguageSwitcher } from "@/components/locale/LanguageSwitcher";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
        <LanguageSwitcher />
        <AdminSignOut />
      </div>
    </>
  );
}
