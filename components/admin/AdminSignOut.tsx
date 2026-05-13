export function AdminSignOut() {
  return (
    <a
      href="/api/admin-logout"
      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm transition hover:border-red-200 hover:text-red-600"
    >
      Sign out
    </a>
  );
}
