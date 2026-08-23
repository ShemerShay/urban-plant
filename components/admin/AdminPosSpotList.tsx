"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";

import { useLocale } from "@/components/locale/LocaleProvider";
import { formatStoredDeliveryAddressDisplay } from "@/lib/deliveryAddress";
import { posSpotAdminAvailabilityLabel } from "@/lib/displayLabels";
import type { PartnerLocation } from "@/lib/mockLocations";
import { formatPrice } from "@/lib/mockPlants";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";
import { comparePosSpotsByPosNumberAsc } from "@/lib/posSpotSort";
import { posSpotPocketLabel } from "@/lib/posSpotPocket";
import {
  absoluteAppUrl,
  getClientOrigin,
  posSpotPath,
  routes,
} from "@/lib/routes";
import { addCalendarDaysUtc, utcCalendarDateString } from "@/lib/storageUtils";

type OfferRow = {
  id: string;
  productId: string;
  productName: string;
  consumerPrice: number;
  currency: "ILS" | "USD" | "EUR";
  status: "active" | "inactive";
};

type PosSpotsApiResponse = {
  posSpots?: PosSpot[];
  offers?: OfferRow[];
  locations?: PartnerLocation[];
};

const partnerSelectClass =
  "h-11 w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white pl-3 pr-9 text-sm font-medium text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

function subscribeToNothing(): () => void {
  return () => {};
}

function useClientOrigin(): string {
  return useSyncExternalStore(subscribeToNothing, getClientOrigin, () => "");
}

function intlLocale(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en-US";
}

function formatCreatedAt(value: string | undefined, locale: Locale): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

function statusClassName(status: PosSpotStatus): string {
  if (status === "available") return "bg-emerald-100 text-emerald-800";
  if (status === "sold") return "bg-slate-100 text-slate-700";
  if (status === "held_for_payment") return "bg-amber-100 text-amber-900";
  return "bg-amber-100 text-amber-800";
}

function PosSpotCard({
  spot,
  location,
  offer,
  origin,
  locale,
}: {
  spot: PosSpot;
  location: PartnerLocation | undefined;
  offer: OfferRow | undefined;
  origin: string;
  locale: Locale;
}) {
  const qrHostRef = useRef<HTMLDivElement>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const relativePath = posSpotPath(spot.spotSlug);
  const fullUrl = origin ? absoluteAppUrl(origin, relativePath) : "";
  const createdLabel = formatCreatedAt(spot.createdAt, locale);
  const nextVisitIso = spot.nextCheck ?? addCalendarDaysUtc(utcCalendarDateString(), 7);
  const nextVisitLabel = formatDateOnly(nextVisitIso, locale) ?? nextVisitIso;
  const offerPlacedLabel = formatCreatedAt(spot.offerPlacedAt, locale);
  const pocketLabel = posSpotPocketLabel(spot);

  async function handleCopyUrl() {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyHint(t(locale, "admin.common.copied"));
      window.setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setCopyHint(t(locale, "admin.common.copyFailed"));
      window.setTimeout(() => setCopyHint(null), 2000);
    }
  }

  function handleDownloadQr() {
    const svg = qrHostRef.current?.querySelector("svg");
    if (!svg) return;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    if (!clone.getAttribute("xmlns")) {
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }

    const serializer = new XMLSerializer();
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(clone)}`;
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const safeSlug = spot.spotSlug.replace(/[^a-zA-Z0-9_-]/g, "");
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `urban-plant-qr-${safeSlug}.svg`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  }

  const urlDisplay =
    fullUrl || `${relativePath} ${t(locale, "admin.pos.urlPending")}`;

  return (
    <article
      className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]"
      data-spot-slug={spot.spotSlug}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-emerald-950">{spot.spotName}</h2>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClassName(spot.status)}`}
              >
                {posSpotAdminAvailabilityLabel(locale, spot.status)}
              </span>
            </div>
            {spot.spotDescription ? (
              <p className="text-sm text-slate-600">{spot.spotDescription}</p>
            ) : null}
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">{t(locale, "admin.common.offer")}</dt>
              <dd className="text-slate-900">
                {offer
                  ? `${offer.productName} (${formatPrice(offer.consumerPrice, offer.currency, locale)})`
                  : "—"}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">{t(locale, "admin.pos.spotSlug")}</dt>
              <dd className="font-mono text-slate-900">{spot.spotSlug}</dd>
            </div>
            {pocketLabel ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">{t(locale, "admin.common.pocket")}</dt>
                <dd className="text-slate-900">{pocketLabel}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">{t(locale, "admin.common.location")}</dt>
              <dd className="text-slate-900">{location?.name ?? spot.partnerLocationId}</dd>
            </div>
            {location?.address ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">{t(locale, "admin.common.address")}</dt>
                <dd className="text-slate-900">
                  {formatStoredDeliveryAddressDisplay(location.address, locale)}
                </dd>
              </div>
            ) : null}
            {spot.posNumber ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">{t(locale, "admin.pos.posNumber")}</dt>
                <dd className="text-slate-900">{spot.posNumber}</dd>
              </div>
            ) : null}
            {spot.placementNotes ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">{t(locale, "admin.pos.placement")}</dt>
                <dd className="text-slate-900">{spot.placementNotes}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">{t(locale, "admin.pos.checkStatus")}</dt>
              <dd className="text-slate-900">
                {spot.checkStatus
                  ? t(locale, "admin.pos.checked")
                  : t(locale, "admin.pos.unchecked")}
                {spot.checkStatus && spot.checkBy ? ` · ${spot.checkBy}` : ""}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">{t(locale, "admin.pos.nextVisit")}</dt>
              <dd className="text-slate-900">{nextVisitLabel}</dd>
            </div>
            {spot.posWeeklyNote ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">{t(locale, "admin.pos.weeklyNote")}</dt>
                <dd className="text-slate-900">{spot.posWeeklyNote}</dd>
              </div>
            ) : null}
            {offerPlacedLabel ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">{t(locale, "admin.pos.offerPlaced")}</dt>
                <dd className="text-slate-900">{offerPlacedLabel}</dd>
              </div>
            ) : null}
            {createdLabel ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">{t(locale, "admin.pos.created")}</dt>
                <dd className="text-slate-900">{createdLabel}</dd>
              </div>
            ) : null}
          </dl>

          <p className="break-all font-mono text-xs text-slate-500">{urlDisplay}</p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyUrl()}
              disabled={!fullUrl}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(locale, "admin.pos.copyQrUrl")}
            </button>
            <Link
              href={relativePath}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50"
            >
              {t(locale, "admin.pos.openPage")}
            </Link>
            <Link
              href={routes.admin.posSpotEdit(spot.id)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              {t(locale, "admin.pos.editDetails")}
            </Link>
            <button
              type="button"
              onClick={handleDownloadQr}
              disabled={!fullUrl}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(locale, "admin.pos.downloadQrSvg")}
            </button>
            {copyHint ? <span className="self-center text-xs text-emerald-800">{copyHint}</span> : null}
          </div>
        </div>

        <div
          className="mx-auto flex w-full max-w-[140px] shrink-0 flex-col items-center sm:mx-0"
          aria-label={t(locale, "admin.pos.qrAria", { slug: spot.spotSlug })}
        >
          <div className="w-full rounded-2xl bg-white p-3 ring-1 ring-emerald-100" ref={qrHostRef}>
            {fullUrl ? (
              <QRCode
                value={fullUrl}
                size={120}
                fgColor="#000000"
                bgColor="transparent"
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl bg-emerald-50 text-center text-xs text-slate-600">
                {t(locale, "admin.pos.preparingQr")}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function AdminPosSpotList() {
  const locale = useLocale();
  const origin = useClientOrigin();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [posSpots, setPosSpots] = useState<PosSpot[]>([]);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [locations, setLocations] = useState<PartnerLocation[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const partnerFilter = searchParams.get("partner") ?? "all";

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(routes.api.posSpots(), { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setLoadError(t(locale, "admin.pos.loadFailed"));
          return;
        }
        const data = (await res.json()) as PosSpotsApiResponse;
        if (cancelled) return;
        const spots = [...(data.posSpots ?? [])].sort(comparePosSpotsByPosNumberAsc);
        setPosSpots(spots);
        setOffers(data.offers ?? []);
        setLocations(data.locations ?? []);
      } catch {
        if (!cancelled) setLoadError(t(locale, "admin.pos.networkLoad"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const locationById = new Map(locations.map((loc) => [loc.id, loc]));
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));

  const partnerOptions = useMemo(() => {
    const ids = new Set(posSpots.map((spot) => spot.partnerLocationId));
    return [...ids]
      .map((id) => ({
        value: id,
        label: locationById.get(id)?.name ?? id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, intlLocale(locale)));
  }, [posSpots, locations, locale]);

  const filteredSpots =
    partnerFilter === "all"
      ? posSpots
      : posSpots.filter((spot) => spot.partnerLocationId === partnerFilter);

  function setPartnerFilter(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("partner");
    else params.set("partner", value);
    const qs = params.toString();
    router.push(routes.admin.posSpotsWithQuery(qs));
  }

  if (isLoading) {
    return <p className="text-sm text-slate-600">{t(locale, "admin.pos.loading")}</p>;
  }

  if (loadError) {
    return <p className="text-sm text-red-700">{loadError}</p>;
  }

  if (posSpots.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-5 text-sm text-slate-600 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p>{t(locale, "admin.pos.empty")}</p>
        <p className="mt-2">
          <Link href={routes.admin.qr()} className="font-medium text-emerald-700 underline underline-offset-2">
            {t(locale, "admin.pos.createLink")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <section aria-label={t(locale, "admin.pos.filterAria")} className="mb-6">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t(locale, "admin.common.partner")}
          </span>
          <select
            className={partnerSelectClass}
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
          >
            <option value="all" className="text-slate-900">
              {t(locale, "admin.common.all")}
            </option>
            {partnerOptions.map((opt) => (
              <option key={opt.value} value={opt.value} className="text-slate-900">
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {filteredSpots.length === 0 ? (
        <div className="rounded-3xl bg-white p-5 text-sm text-slate-600 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <p>{t(locale, "admin.pos.noMatch")}</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {filteredSpots.map((spot) => (
            <li key={spot.id}>
              <PosSpotCard
                spot={spot}
                location={locationById.get(spot.partnerLocationId)}
                offer={offerById.get(spot.currentOfferId)}
                origin={origin}
                locale={locale}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
