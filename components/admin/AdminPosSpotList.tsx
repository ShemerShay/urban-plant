"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";

import type { PartnerLocation } from "@/lib/mockLocations";
import { formatPrice } from "@/lib/mockPlants";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";
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

function formatCreatedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateOnly(isoDate: string | undefined): string | null {
  if (!isoDate) return null;
  const parts = isoDate.split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Admin list copy only; customer plant page still shows "Sold" via `INVENTORY_STATUS_LABELS`. */
function statusLabel(status: PosSpotStatus): string {
  if (status === "available") return "Available";
  if (status === "sold") return "Unavailable";
  return "Inactive";
}

function statusClassName(status: PosSpotStatus): string {
  if (status === "available") return "bg-emerald-100 text-emerald-800";
  if (status === "sold") return "bg-slate-100 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

/**
 * POS list cards stay read-only with compact actions only: the admin column is `max-w-md`
 * and each card already carries QR + URL + several buttons, so multi-field editing lives on
 * `/admin/pos-spots/[id]/edit` instead of crowding this layout.
 */
function PosSpotCard({
  spot,
  location,
  offer,
  origin,
}: {
  spot: PosSpot;
  location: PartnerLocation | undefined;
  offer: OfferRow | undefined;
  origin: string;
}) {
  const qrHostRef = useRef<HTMLDivElement>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const relativePath = posSpotPath(spot.spotSlug);
  const fullUrl = origin ? absoluteAppUrl(origin, relativePath) : "";
  const createdLabel = formatCreatedAt(spot.createdAt);
  const nextVisitIso = spot.nextCheck ?? addCalendarDaysUtc(utcCalendarDateString(), 7);
  const nextVisitLabel = formatDateOnly(nextVisitIso) ?? nextVisitIso;
  const offerPlacedLabel = formatCreatedAt(spot.offerPlacedAt);
  const pocketLabel = posSpotPocketLabel(spot);

  async function handleCopyUrl() {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopyHint("Copied");
      window.setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setCopyHint("Could not copy");
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
                {statusLabel(spot.status)}
              </span>
            </div>
            {spot.spotDescription ? (
              <p className="text-sm text-slate-600">{spot.spotDescription}</p>
            ) : null}
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Display name</dt>
              <dd className="text-slate-900">{spot.posName}</dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Spot slug</dt>
              <dd className="font-mono text-slate-900">{spot.spotSlug}</dd>
            </div>
            {pocketLabel ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Pocket</dt>
                <dd className="text-slate-900">{pocketLabel}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Location</dt>
              <dd className="text-slate-900">{location?.name ?? spot.partnerLocationId}</dd>
            </div>
            {location?.address ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Address</dt>
                <dd className="text-slate-900">{location.address}</dd>
              </div>
            ) : null}
            {offer ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Offer</dt>
                <dd className="text-slate-900">
                  {offer.productName} ({formatPrice(offer.consumerPrice, offer.currency)})
                </dd>
              </div>
            ) : (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Offer</dt>
                <dd className="text-slate-600">{spot.currentOfferId}</dd>
              </div>
            )}
            {spot.posNumber ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">POS number</dt>
                <dd className="text-slate-900">{spot.posNumber}</dd>
              </div>
            ) : null}
            {spot.placementNotes ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Placement</dt>
                <dd className="text-slate-900">{spot.placementNotes}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Check status</dt>
              <dd className="text-slate-900">
                {spot.checkStatus ? "Checked" : "Unchecked"}
                {spot.checkStatus && spot.checkBy ? ` · ${spot.checkBy}` : ""}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="font-medium text-slate-500">Next visit</dt>
              <dd className="text-slate-900">{nextVisitLabel}</dd>
            </div>
            {spot.posWeeklyNote ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Weekly note</dt>
                <dd className="text-slate-900">{spot.posWeeklyNote}</dd>
              </div>
            ) : null}
            {offerPlacedLabel ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Offer placed</dt>
                <dd className="text-slate-900">{offerPlacedLabel}</dd>
              </div>
            ) : null}
            {createdLabel ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-slate-500">Created</dt>
                <dd className="text-slate-900">{createdLabel}</dd>
              </div>
            ) : null}
          </dl>

          <p className="break-all font-mono text-xs text-slate-500">
            {fullUrl || `${relativePath} (full URL loads after page mounts)`}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyUrl()}
              disabled={!fullUrl}
              className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copy QR URL
            </button>
            <Link
              href={relativePath}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-50"
            >
              Open POS page
            </Link>
            <Link
              href={routes.admin.posSpotEdit(spot.id)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
            >
              Edit details
            </Link>
            <button
              type="button"
              onClick={handleDownloadQr}
              disabled={!fullUrl}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download QR (SVG)
            </button>
            {copyHint ? <span className="self-center text-xs text-emerald-800">{copyHint}</span> : null}
          </div>
        </div>

        <div
          className="mx-auto flex w-full max-w-[140px] shrink-0 flex-col items-center sm:mx-0"
          aria-label={`QR code for ${spot.spotSlug}`}
        >
          <div className="w-full rounded-2xl bg-white p-3 ring-1 ring-emerald-100" ref={qrHostRef}>
            {fullUrl ? (
              <QRCode
                value={fullUrl}
                size={120}
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl bg-emerald-50 text-center text-xs text-slate-600">
                Preparing QR…
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function AdminPosSpotList() {
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
          if (!cancelled) setLoadError("Could not load POS Spots");
          return;
        }
        const data = (await res.json()) as PosSpotsApiResponse;
        if (cancelled) return;
        const spots = [...(data.posSpots ?? [])].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
        setPosSpots(spots);
        setOffers(data.offers ?? []);
        setLocations(data.locations ?? []);
      } catch {
        if (!cancelled) setLoadError("Network error while loading POS Spots");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const locationById = new Map(locations.map((loc) => [loc.id, loc]));
  const offerById = new Map(offers.map((offer) => [offer.id, offer]));

  const partnerOptions = useMemo(() => {
    const ids = new Set(posSpots.map((spot) => spot.partnerLocationId));
    return [...ids]
      .map((id) => ({
        value: id,
        label: locationById.get(id)?.name ?? id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [posSpots, locations]);

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
    return <p className="text-sm text-slate-600">Loading POS Spots…</p>;
  }

  if (loadError) {
    return <p className="text-sm text-red-700">{loadError}</p>;
  }

  if (posSpots.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-5 text-sm text-slate-600 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <p>No POS Spots yet.</p>
        <p className="mt-2">
          <Link href={routes.admin.qr()} className="font-medium text-emerald-700 underline underline-offset-2">
            Create a POS Spot
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <section aria-label="Filter POS spots" className="mb-6">
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Partner
          </span>
          <select
            className={partnerSelectClass}
            value={partnerFilter}
            onChange={(e) => setPartnerFilter(e.target.value)}
          >
            <option value="all" className="text-slate-900">
              All
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
          <p>No POS Spots match the selected partner.</p>
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
          />
        </li>
      ))}
    </ul>
      )}
    </>
  );
}
