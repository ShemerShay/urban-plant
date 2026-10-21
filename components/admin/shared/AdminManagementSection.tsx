"use client";

import { useState, type ReactNode } from "react";

type AdminManagementSectionProps = {
  id?: string;
  title: string;
  /** Optional muted count or label shown after a middle dot in the heading. */
  titleMeta?: ReactNode;
  description?: string;
  actions?: ReactNode;
  /** When set, the title toggles the body open/closed. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
};

/** Partner-page (and similar) section shell: title, optional actions, body. */
export function AdminManagementSection({
  id,
  title,
  titleMeta,
  description,
  actions,
  collapsible = false,
  defaultOpen = true,
  children,
}: AdminManagementSectionProps) {
  const [isOpen, setIsOpen] = useState(collapsible ? defaultOpen : true);
  const bodyId = id ? `${id}-body` : undefined;

  const heading = (
    <div className="min-w-0">
      <h2 className="flex flex-wrap items-baseline text-lg font-semibold text-emerald-950">
        <span>{title}</span>
        {titleMeta ? (
          <span className="text-sm font-normal text-slate-600">
            <span className="mx-1.5 text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className="whitespace-nowrap">{titleMeta}</span>
          </span>
        ) : null}
      </h2>
      {description ? (
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
      ) : null}
    </div>
  );

  return (
    <section
      id={id}
      className="scroll-mt-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
    >
      <div
        className={`flex flex-wrap items-start justify-between gap-3 ${isOpen ? "mb-4" : ""}`}
      >
        {collapsible ? (
          <button
            type="button"
            onClick={() => setIsOpen((open) => !open)}
            aria-expanded={isOpen}
            aria-controls={bodyId}
            className="flex min-w-0 flex-1 items-start gap-2 text-start"
          >
            <svg
              className={`mt-1 h-5 w-5 shrink-0 text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M6 9l6 6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {heading}
          </button>
        ) : (
          heading
        )}
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {isOpen ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}
