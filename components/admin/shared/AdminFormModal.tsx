"use client";

import type { ReactNode } from "react";

type AdminFormModalProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  error?: string | null;
  busy?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: () => void;
  onCancel: () => void;
  canSubmit?: boolean;
};

export function AdminFormModal({
  open,
  title,
  children,
  error,
  busy = false,
  submitLabel = "Save",
  cancelLabel = "Cancel",
  onSubmit,
  onCancel,
  canSubmit = true,
}: AdminFormModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-form-modal-title"
    >
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl bg-white p-5 shadow-xl">
        <h3 id="admin-form-modal-title" className="text-lg font-semibold text-emerald-950">
          {title}
        </h3>
        <div className="mt-4 space-y-3">{children}</div>
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !canSubmit}
            className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
          >
            {busy ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
