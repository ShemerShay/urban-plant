import type { ReactNode } from "react";

type AdminManagementSectionProps = {
  id?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

/** Partner-page (and similar) section shell: title, optional actions, body. */
export function AdminManagementSection({
  id,
  title,
  description,
  actions,
  children,
}: AdminManagementSectionProps) {
  return (
    <section
      id={id}
      className="scroll-mt-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-emerald-950">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
