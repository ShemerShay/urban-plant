import type { ReactNode } from "react";

type AdminEmptyStateProps = {
  message: string;
  action?: ReactNode;
};

export function AdminEmptyState({ message, action }: AdminEmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center">
      <p className="text-sm text-slate-600">{message}</p>
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}
