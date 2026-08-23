"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useLocale } from "@/components/locale/LocaleProvider";
import {
  adminHeldForPaymentLabel,
  displayApiError,
  offerStatusLabel,
  posSpotAdminAvailabilityLabel,
} from "@/lib/displayLabels";
import type { PartnerLocation } from "@/lib/mockLocations";
import { formatPrice } from "@/lib/mockPlants";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import {
  POS_SPOT_POCKETS,
  type PosSpotPocketValue,
  pocketDisplayLabel,
} from "@/lib/posSpotPocket";
import { buildPosSpotNameAndSlug } from "@/lib/posSpotSlugUtils";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";
import {
  absoluteAppUrl,
  getClientOrigin,
  posSpotPath,
  routes,
} from "@/lib/routes";

type OfferRow = {
  id: string;
  productId: string;
  productName: string;
  consumerPrice: number;
  currency: "ILS" | "USD" | "EUR";
  status: "active" | "inactive";
};

type EditLoadResponse = {
  posSpot?: PosSpot;
  offers?: OfferRow[];
  locations?: PartnerLocation[];
  error?: string;
};

function subscribeToNothing(): () => void {
  return () => {};
}

function useClientOrigin(): string {
  return useSyncExternalStore(subscribeToNothing, getClientOrigin, () => "");
}

function intlLocale(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

function isoToDatetimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIso(value: string): string | null {
  if (!value.trim()) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString();
}

function formatDateOnly(isoDate: string | undefined, locale: Locale): string | null {
  if (!isoDate) return null;
  const parts = isoDate.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function AdminPosSpotEditForm({ posSpotId }: { posSpotId: string }) {
  const locale = useLocale();
  const router = useRouter();
  const origin = useClientOrigin();

  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [initialSpot, setInitialSpot] = useState<PosSpot | null>(null);

  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [locations, setLocations] = useState<PartnerLocation[]>([]);

  const [partnerLocationId, setPartnerLocationId] = useState("");
  const [partnerLocationAddress, setPartnerLocationAddress] = useState("");
  const [currentOfferId, setCurrentOfferId] = useState("");
  const [posNumber, setPosNumber] = useState("");
  const [pocket, setPocket] = useState<PosSpotPocketValue | "">("");
  const [pocketOther, setPocketOther] = useState("");
  const [spotDescription, setSpotDescription] = useState("");

  const [availability, setAvailability] = useState<
    Extract<PosSpotStatus, "available" | "sold" | "held_for_payment">
  >("available");
  const [checkStatus, setCheckStatus] = useState(false);
  const [checkBy, setCheckBy] = useState("");
  const [posWeeklyNote, setPosWeeklyNote] = useState("");
  const [offerPlacedAtInput, setOfferPlacedAtInput] = useState("");

  const [saveError, setSaveError] = useState<string | null>(null);
  const [pocketOtherError, setPocketOtherError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setIsLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(routes.api.posSpot(posSpotId), {
          cache: "no-store",
          signal,
        });
        const data = (await res.json().catch(() => ({}))) as EditLoadResponse;
        if (signal.aborted) return;
        if (!res.ok) {
          setLoadError(displayApiError(locale, data.error, "admin.pos.loadFailed"));
          setInitialSpot(null);
          return;
        }
        const spot = data.posSpot;
        if (!spot) {
          setLoadError(t(locale, "admin.pos.edit.notFound"));
          setInitialSpot(null);
          return;
        }
        setInitialSpot(spot);
        setOffers(data.offers ?? []);
        setLocations(data.locations ?? []);
        setPartnerLocationId(spot.partnerLocationId);
        setCurrentOfferId(spot.currentOfferId);
        setPosNumber(spot.posNumber ?? "");
        setPocket((spot.pocket as PosSpotPocketValue) ?? "");
        setPocketOther(spot.pocketOther ?? "");
        setSpotDescription(spot.spotDescription ?? "");
        setAvailability(
          spot.status === "sold"
            ? "sold"
            : spot.status === "held_for_payment"
              ? "held_for_payment"
              : "available",
        );
        setCheckStatus(spot.checkStatus);
        setCheckBy(spot.checkBy ?? "");
        setPosWeeklyNote(spot.posWeeklyNote ?? "");
        setOfferPlacedAtInput(isoToDatetimeLocalValue(spot.offerPlacedAt));
        const loc = (data.locations ?? []).find((l) => l.id === spot.partnerLocationId);
        setPartnerLocationAddress(loc?.address ?? "");
      } catch {
        if (signal.aborted) return;
        setLoadError(t(locale, "admin.pos.edit.networkLoad"));
        setInitialSpot(null);
      } finally {
        setIsLoading(false);
      }
    },
    [posSpotId, locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const partnerLocation = locationById.get(partnerLocationId);

  const generated = useMemo(() => {
    if (!partnerLocation?.name || !posNumber.trim()) {
      return null;
    }
    return buildPosSpotNameAndSlug(partnerLocation.name, posNumber);
  }, [partnerLocation?.name, posNumber]);

  const spotName = initialSpot?.spotName ?? generated?.spotName ?? "";
  const spotSlug = initialSpot?.spotSlug ?? generated?.spotSlug ?? "";

  function handlePartnerChange(nextId: string) {
    setPartnerLocationId(nextId);
    const loc = locationById.get(nextId);
    setPartnerLocationAddress(loc?.address ?? "");
  }

  const offerOptions = useMemo(() => {
    const active = offers.filter((o) => o.status === "active");
    const current = offers.find((o) => o.id === currentOfferId);
    if (current && current.status !== "active") {
      return [current, ...active.filter((o) => o.id !== current.id)];
    }
    return active;
  }, [offers, currentOfferId]);

  const relativePath = useMemo(() => (spotSlug ? posSpotPath(spotSlug) : ""), [spotSlug]);
  const fullUrlPreview = origin && relativePath ? absoluteAppUrl(origin, relativePath) : "";
  const pocketLabel = pocket
    ? pocketDisplayLabel(pocket, pocketOther)
    : initialSpot?.pocket
      ? pocketDisplayLabel(initialSpot.pocket, initialSpot.pocketOther)
      : undefined;

  const pocketValid = !pocket || (pocket !== "other" || pocketOther.trim());
  const canSave = Boolean(
    partnerLocationId.trim() &&
      partnerLocationAddress.trim() &&
      currentOfferId.trim() &&
      posNumber.trim() &&
      pocketValid &&
      (spotSlug.trim() || initialSpot?.spotSlug) &&
      !isSaving &&
      initialSpot,
  );

  async function handleSave() {
    if (pocket === "other" && !pocketOther.trim()) {
      setPocketOtherError(true);
      setSaveError(t(locale, "admin.pos.edit.customPocketRequired"));
      return;
    }
    if (!canSave || !initialSpot) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(routes.api.posSpot(posSpotId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerLocationId,
          partnerLocationAddress,
          currentOfferId,
          posNumber: posNumber.trim(),
          pocket,
          ...(pocket === "other" ? { pocketOther: pocketOther.trim() } : {}),
          ...(spotDescription.trim() ? { spotDescription: spotDescription.trim() } : {}),
          status: availability,
          checkStatus,
          checkBy,
          posWeeklyNote,
          ...(() => {
            if (offerPlacedAtInput.trim()) {
              const iso = datetimeLocalToIso(offerPlacedAtInput);
              return iso ? { offerPlacedAt: iso } : {};
            }
            if (initialSpot.offerPlacedAt) {
              return { offerPlacedAt: null };
            }
            return {};
          })(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSaveError(displayApiError(locale, data.error, "admin.pos.edit.saveFailed"));
        return;
      }
      router.push(routes.admin.posSpots());
    } catch {
      setSaveError(t(locale, "common.networkError"));
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    router.push(routes.admin.posSpots());
  }

  if (isLoading) {
    return <p className="text-sm text-slate-600">{t(locale, "admin.pos.edit.loading")}</p>;
  }

  if (loadError || !initialSpot) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-700">{loadError ?? t(locale, "admin.pos.edit.notFound")}</p>
        <Link
          href={routes.admin.posSpots()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.pos.edit.back")}
        </Link>
      </div>
    );
  }

  const urlDisplay =
    fullUrlPreview || `${relativePath} ${t(locale, "admin.pos.urlPending")}`;

  const nextCheckFormatted =
    formatDateOnly(initialSpot.nextCheck, locale) ?? initialSpot.nextCheck ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            {t(locale, "admin.brand")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">
            {t(locale, "admin.pos.edit.title")}
          </h1>
          <p className="mt-2 text-sm text-slate-600">{t(locale, "admin.pos.edit.intro")}</p>
        </div>
        <Link
          href={routes.admin.posSpots()}
          className="text-sm font-medium text-emerald-700 underline underline-offset-2"
        >
          {t(locale, "admin.pos.edit.back")}
        </Link>
      </div>

      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <div className="grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.common.location")}
            </span>
            <select
              value={partnerLocationId}
              onChange={(e) => handlePartnerChange(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id} className="text-slate-900">
                  {loc.name} — {loc.partnerType}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.pos.edit.addressLabel")}
            </span>
            <textarea
              value={partnerLocationAddress}
              onChange={(e) => setPartnerLocationAddress(e.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder={t(locale, "admin.pos.edit.addressPlaceholder")}
            />
            <span className="text-xs text-slate-500">{t(locale, "admin.pos.edit.addressHint")}</span>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.pos.posNumber")}
            </span>
            <input
              value={posNumber}
              onChange={(e) => setPosNumber(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder="3"
              autoComplete="off"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.common.pocket")}
            </span>
            <select
              value={pocket}
              onChange={(e) => {
                setPocket(e.target.value as PosSpotPocketValue | "");
                if (e.target.value !== "other") setPocketOtherError(false);
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              <option value="" className="text-slate-900">
                {t(locale, "admin.pos.edit.selectPocket")}
              </option>
              {POS_SPOT_POCKETS.map((item) => (
                <option key={item.value} value={item.value} className="text-slate-900">
                  {item.label}
                </option>
              ))}
            </select>
            {!initialSpot.pocket && !pocket ? (
              <span className="text-xs text-amber-700">{t(locale, "admin.pos.edit.legacySpot")}</span>
            ) : null}
          </label>

          {pocket === "other" ? (
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">
                {t(locale, "admin.pos.edit.customPocket")}
              </span>
              <input
                value={pocketOther}
                onChange={(e) => {
                  setPocketOther(e.target.value);
                  if (e.target.value.trim()) setPocketOtherError(false);
                }}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
                placeholder={t(locale, "admin.pos.edit.customPocketPlaceholder")}
                aria-invalid={pocketOtherError && !pocketOther.trim()}
              />
              {pocketOtherError && !pocketOther.trim() ? (
                <span className="text-sm text-red-700">
                  {t(locale, "admin.pos.edit.customPocketRequiredShort")}
                </span>
              ) : null}
            </label>
          ) : null}

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.pos.edit.descriptionOptional")}
            </span>
            <input
              value={spotDescription}
              onChange={(e) => setSpotDescription(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              placeholder={t(locale, "admin.pos.edit.descriptionPlaceholder")}
              autoComplete="off"
            />
          </label>

          <div className="rounded-2xl bg-slate-50/80 px-3 py-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t(locale, "admin.pos.edit.spotIdentifiers")}
            </p>
            <div className="space-y-1 text-sm">
              {spotName ? (
                <p>
                  <span className="font-medium text-slate-500">
                    {t(locale, "admin.pos.edit.spotName")}{" "}
                  </span>
                  <span className="font-mono text-slate-900">{spotName}</span>
                </p>
              ) : null}
              {spotSlug ? (
                <p>
                  <span className="font-medium text-slate-500">
                    {t(locale, "admin.pos.edit.spotSlugLabel")}{" "}
                  </span>
                  <span className="font-mono text-slate-900">{spotSlug}</span>
                </p>
              ) : null}
              {pocketLabel ? (
                <p>
                  <span className="font-medium text-slate-500">
                    {t(locale, "admin.common.pocket")}{" "}
                  </span>
                  <span className="text-slate-900">{pocketLabel}</span>
                </p>
              ) : null}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">
              {t(locale, "admin.pos.edit.availability")}
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                type="button"
                aria-pressed={availability === "available"}
                onClick={() => setAvailability("available")}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                  availability === "available"
                    ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {posSpotAdminAvailabilityLabel(locale, "available")}
              </button>
              <button
                type="button"
                aria-pressed={availability === "sold"}
                onClick={() => setAvailability("sold")}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                  availability === "sold"
                    ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {posSpotAdminAvailabilityLabel(locale, "sold")}
              </button>
              <button
                type="button"
                aria-pressed={availability === "held_for_payment"}
                onClick={() => setAvailability("held_for_payment")}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                  availability === "held_for_payment"
                    ? "border-amber-700 bg-amber-50 text-amber-950"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {adminHeldForPaymentLabel(locale)}
              </button>
            </div>
            {initialSpot.status === "inactive" ? (
              <p className="text-xs text-amber-700">{t(locale, "admin.pos.edit.inactiveHint")}</p>
            ) : availability === "held_for_payment" ? (
              <p className="text-xs text-amber-800">{t(locale, "admin.pos.edit.heldHint")}</p>
            ) : (
              <p className="text-xs text-slate-500">{t(locale, "admin.pos.edit.unavailableHint")}</p>
            )}
          </fieldset>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">
              {t(locale, "admin.common.offer")}
            </span>
            <select
              value={currentOfferId}
              onChange={(e) => setCurrentOfferId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {offerOptions.map((item) => (
                <option key={item.id} value={item.id} className="text-slate-900">
                  {item.productName} ({formatPrice(item.consumerPrice, item.currency, locale)})
                  {item.status !== "active"
                    ? ` — ${offerStatusLabel(locale, item.status)}`
                    : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t(locale, "admin.pos.edit.maintenance")}
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-slate-700" id="pos-checked-label">
                {t(locale, "admin.pos.edit.posChecked")}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={checkStatus}
                aria-labelledby="pos-checked-label"
                onClick={() => setCheckStatus((c) => !c)}
                className={`flex h-8 w-14 shrink-0 items-center rounded-full px-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 ${
                  checkStatus ? "justify-end bg-emerald-600" : "justify-start bg-slate-300"
                }`}
              >
                <span
                  aria-hidden
                  className="h-7 w-7 rounded-full bg-white shadow-sm ring-1 ring-black/5"
                />
              </button>
            </div>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">
                {t(locale, "admin.pos.edit.checkedBy")}
              </span>
              <input
                value={checkBy}
                onChange={(e) => setCheckBy(e.target.value)}
                disabled={!checkStatus}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60 disabled:opacity-50"
                placeholder={t(locale, "admin.pos.edit.checkedByPlaceholder")}
                autoComplete="off"
              />
            </label>
            {initialSpot.nextCheck ? (
              <p className="text-xs text-slate-600">
                {t(locale, "admin.pos.edit.nextCheck", { date: nextCheckFormatted })}
              </p>
            ) : null}
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">
                {t(locale, "admin.pos.edit.weeklyNoteOptional")}
              </span>
              <textarea
                value={posWeeklyNote}
                onChange={(e) => setPosWeeklyNote(e.target.value)}
                rows={2}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
                placeholder={t(locale, "admin.pos.edit.weeklyNotePlaceholder")}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-medium text-slate-700">
                {t(locale, "admin.pos.edit.offerPlacedOptional")}
              </span>
              <input
                type="datetime-local"
                value={offerPlacedAtInput}
                onChange={(e) => setOfferPlacedAtInput(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
              />
              <span className="text-xs text-slate-500">
                {t(locale, "admin.pos.edit.offerPlacedClear")}
              </span>
            </label>
          </div>

          <div className="rounded-2xl bg-emerald-50/60 px-3 py-2">
            <p className="text-xs font-medium text-slate-600">{t(locale, "admin.pos.edit.urlPreview")}</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-800">{urlDisplay}</p>
          </div>

          {saveError ? <p className="text-sm text-red-700">{saveError}</p> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? t(locale, "admin.shared.saving") : t(locale, "admin.shared.save")}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(locale, "admin.shared.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
