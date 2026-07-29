import type { ReactNode } from "react";

import { AdminEmptyState } from "./AdminEmptyState";

export type AdminEntityListItem = {
  id: string;
  title: string;
  meta?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
};

type AdminEntityListProps = {
  items: AdminEntityListItem[];
  emptyMessage: string;
  emptyAction?: ReactNode;
};

/** Simple reusable admin entity list (pockets, spots, etc.). */
export function AdminEntityList({ items, emptyMessage, emptyAction }: AdminEntityListProps) {
  if (items.length === 0) {
    return <AdminEmptyState message={emptyMessage} action={emptyAction} />;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-emerald-950">{item.title}</span>
                {item.meta}
              </div>
              {item.details ? <div className="mt-2">{item.details}</div> : null}
            </div>
            {item.actions ? (
              <div className="flex shrink-0 flex-wrap gap-2">{item.actions}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
