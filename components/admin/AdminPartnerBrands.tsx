"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { AdminFormModal } from "@/components/admin/shared/AdminFormModal";
import { useLocale } from "@/components/locale/LocaleProvider";
import { displayApiError } from "@/lib/displayLabels";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import type { PartnerLocation } from "@/lib/partnerLocationStorage";
import type { Partner } from "@/lib/partnerStorage";
import { routes } from "@/lib/routes";

/** Mount only while open so each opening starts from `initial`. */
function PartnerBrandModal({
  title,
  initial,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: { name: string };
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (value: { name: string }) => Promise<string | null>;
}) {
  const locale = useLocale();
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) {
      setError(t(locale, "validation.required"));
      return;
    }
    setBusy(true);
    const failure = await onSubmit({ name: name.trim() });
    setBusy(false);
    setError(failure);
  }

  return (
    <AdminFormModal
      open
      title={title}
      busy={busy}
      error={error}
      submitLabel={submitLabel}
      onCancel={onCancel}
      onSubmit={() => void submit()}
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium text-slate-700">{t(locale, "admin.common.name")}</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900"
        />
      </label>
    </AdminFormModal>
  );
}

type BrandsPageData =
  | { partners: Partner[]; locations: PartnerLocation[] }
  | { error: string };

async function fetchBrandsPageData(locale: Locale): Promise<BrandsPageData> {
  try {
    const [brandsRes, locationsRes] = await Promise.all([
      fetch(routes.api.partnerBrands(), { cache: "no-store" }),
      fetch(routes.api.partners(), { cache: "no-store" }),
    ]);
    const brandsData = (await brandsRes.json().catch(() => ({}))) as {
      partners?: Partner[];
      error?: string;
    };
    const locationsData = (await locationsRes.json().catch(() => ({}))) as {
      partners?: PartnerLocation[];
      error?: string;
    };
    if (!brandsRes.ok || !locationsRes.ok) {
      return {
        error: displayApiError(
          locale,
          brandsData.error ?? locationsData.error,
          "admin.partners.loadFailed",
        ),
      };
    }
    return { partners: brandsData.partners ?? [], locations: locationsData.partners ?? [] };
  } catch {
    return { error: t(locale, "admin.partners.networkLoad") };
  }
}

/** Top-level partners (businesses/brands) with their location counts. */
export function AdminPartnerBrandsManager({
  initialPartners,
  initialLocations,
}: {
  initialPartners: Partner[];
  initialLocations: PartnerLocation[];
}) {
  const locale = useLocale();
  const [partners, setPartners] = useState<Partner[]>(initialPartners);
  const [locations, setLocations] = useState<PartnerLocation[]>(initialLocations);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const locationsByPartnerId = useMemo(() => {
    const map = new Map<string, PartnerLocation[]>();
    for (const location of locations) {
      const list = map.get(location.partnerId) ?? [];
      list.push(location);
      map.set(location.partnerId, list);
    }
    return map;
  }, [locations]);

  const applyLoadResult = useCallback((result: BrandsPageData) => {
    if ("error" in result) {
      setLoadError(result.error);
    } else {
      setLoadError(null);
      setPartners(result.partners);
      setLocations(result.locations);
    }
    setLoading(false);
  }, []);

  const load = useCallback(
    async () => applyLoadResult(await fetchBrandsPageData(locale)),
    [applyLoadResult, locale],
  );

  async function createPartner(value: { name: string }) {
    try {
      const res = await fetch(routes.api.partnerBrands(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return displayApiError(locale, data.error, "admin.partners.createFailed");
      setCreateOpen(false);
      await load();
      return null;
    } catch {
      return t(locale, "common.networkError");
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            {t(locale, "admin.brand")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">
            {t(locale, "admin.partners.title")}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
        >
          {t(locale, "admin.partners.new")}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-600">{t(locale, "admin.partners.loading")}</p>
      ) : loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : partners.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          {t(locale, "admin.partners.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {partners.map((partner) => {
            const branches = locationsByPartnerId.get(partner.id) ?? [];
            return (
              <li key={partner.id}>
                <Link
                  href={routes.admin.partner(partner.id)}
                  className="flex items-center gap-4 rounded-3xl bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.04)] transition hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold text-emerald-950">
                      {partner.name}
                    </span>
                    <span className="mt-0.5 block truncate text-sm text-slate-600">
                      {branches.length === 1
                        ? t(locale, "admin.partners.brand.locationCountOne")
                        : t(locale, "admin.partners.brand.locationCountMany", {
                            count: branches.length,
                          })}
                      {branches.length > 0
                        ? ` · ${branches.map((branch) => branch.name).join(", ")}`
                        : ""}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {createOpen ? (
        <PartnerBrandModal
          title={t(locale, "admin.partners.new")}
          submitLabel={t(locale, "admin.partners.create")}
          initial={{ name: "" }}
          onCancel={() => setCreateOpen(false)}
          onSubmit={createPartner}
        />
      ) : null}
    </>
  );
}

/** Partner page header with edit (name). */
export function AdminPartnerBrandHeader({ initialPartner }: { initialPartner: Partner }) {
  const locale = useLocale();
  const [partner, setPartner] = useState(initialPartner);
  const [editOpen, setEditOpen] = useState(false);

  async function savePartner(value: { name: string }) {
    try {
      const res = await fetch(routes.api.partnerBrand(partner.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const data = (await res.json().catch(() => ({}))) as { partner?: Partner; error?: string };
      if (!res.ok || !data.partner) {
        return displayApiError(locale, data.error, "admin.partners.saveFailed");
      }
      setPartner(data.partner);
      setEditOpen(false);
      return null;
    } catch {
      return t(locale, "common.networkError");
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
          {t(locale, "admin.common.partner")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-emerald-950">{partner.name}</h1>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.common.edit")}
        </button>
        <Link
          href={routes.admin.partners()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.partners.detail.allPartners")}
        </Link>
      </div>
      {editOpen ? (
        <PartnerBrandModal
          title={t(locale, "admin.partners.brand.edit")}
          initial={{ name: partner.name }}
          onCancel={() => setEditOpen(false)}
          onSubmit={savePartner}
        />
      ) : null}
    </div>
  );
}
