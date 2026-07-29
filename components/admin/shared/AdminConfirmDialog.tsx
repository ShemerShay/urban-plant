"use client";

type AdminConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AdminConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: AdminConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-confirm-title"
    >
      <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
        <h3 id="admin-confirm-title" className="text-lg font-semibold text-emerald-950">
          {title}
        </h3>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{message}</p>
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
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${
              destructive
                ? "bg-red-700 hover:bg-red-800"
                : "bg-emerald-800 hover:bg-emerald-900"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
