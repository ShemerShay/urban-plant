"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { OrderStatus } from "@/lib/status";
import { ORDER_STATUS_LABELS } from "@/lib/status";

const OPTIONS: OrderStatus[] = [
  "pending_payment",
  "sold",
  "picked_up",
  "delivered",
  "available",
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`size-4 shrink-0 text-slate-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function AdminOrderStatusSelect(props: {
  id: string;
  value: OrderStatus;
  disabled?: boolean;
  onChange: (next: OrderStatus) => void;
}) {
  const { id, value, disabled, onChange } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function pick(next: OrderStatus) {
    onChange(next);
    setOpen(false);
  }

  const triggerInner =
    "flex h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-emerald-950 outline-none focus-visible:bg-slate-50 disabled:opacity-60";

  return (
    <div ref={rootRef} className="relative mt-1">
      <button
        type="button"
        id={id}
        disabled={disabled}
        className={`${triggerInner} border border-slate-200 bg-white focus-visible:ring-2 focus-visible:ring-slate-200/60 ${
          open ? "rounded-t-xl rounded-b-none border-b-0 shadow-sm" : "rounded-xl shadow-sm"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="min-w-0 truncate">{ORDER_STATUS_LABELS[value]}</span>
        <Chevron open={open} />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Order status options"
          className="absolute left-0 right-0 top-full z-50 max-h-60 overflow-auto rounded-b-xl border border-slate-200 border-t bg-white py-1 shadow-lg"
        >
          {OPTIONS.map((opt) => (
            <li key={opt} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={opt === value}
                className={`w-full px-3 py-2.5 text-left text-sm outline-none transition hover:bg-slate-50 focus-visible:bg-slate-100 ${
                  opt === value ? "bg-slate-100 font-semibold text-emerald-950" : "font-medium text-emerald-950"
                }`}
                onClick={() => !disabled && pick(opt)}
              >
                {ORDER_STATUS_LABELS[opt]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
