"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { isAdminPath, routes } from "@/lib/routes";

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

function safeAdminRedirect(from: string | null): string {
  if (!from) return routes.admin.index();
  const path = from.split("?")[0] ?? "";
  if (!isAdminPath(path) || path === routes.admin.login()) {
    return routes.admin.index();
  }
  return from.startsWith("/") ? from : routes.admin.index();
}

export function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = safeAdminRedirect(searchParams.get("from"));

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(routes.api.adminLogin(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push(from);
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Incorrect password.");
        setPassword("");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
        Urban Plant · Admin
      </p>
      <h1 className="mt-2 font-serif-display text-3xl font-semibold text-emerald-950">
        Admin access
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Enter the password to open admin tools.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <label htmlFor="admin-password" className="text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            className={inputClass}
            placeholder="••••••••"
          />
        </div>

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-emerald-700 px-5 py-4 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
        >
          {loading ? "Checking…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
