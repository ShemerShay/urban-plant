"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

function IconMoreVertical({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

export function AdminOrdersHeaderMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative flex items-center" id="admin-orders-header-menu" ref={rootRef}>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-800 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/45"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Page actions"
        onClick={() => setOpen((o) => !o)}
      >
        <IconMoreVertical />
      </button>

      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-2 min-w-[12rem] overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200"
          role="menu"
          aria-orientation="vertical"
        >
          <Link
            href="/admin/qr"
            role="menuitem"
            className="block px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            + pos spot
          </Link>
          <Link
            href="/admin/orders/new"
            role="menuitem"
            className="block px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            Add New Order
          </Link>
          <div className="my-1 border-t border-slate-100" />
          <Link
            href="/"
            role="menuitem"
            className="block px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-50"
            onClick={() => setOpen(false)}
          >
            Home
          </Link>
        </div>
      ) : null}
    </div>
  );
}
