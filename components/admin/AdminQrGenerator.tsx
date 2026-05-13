"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import QRCode from "react-qr-code";

import { locations } from "@/lib/mockLocations";
import { formatPrice, mockPlants } from "@/lib/mockPlants";
import { plantPagePath } from "@/lib/qrNavigation";

function clientOriginSnapshot(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

function subscribeToNothing(): () => void {
  return () => {};
}

function useClientOrigin(): string {
  return useSyncExternalStore(subscribeToNothing, clientOriginSnapshot, () => "");
}

export function AdminQrGenerator() {
  const qrHostRef = useRef<HTMLDivElement>(null);
  const origin = useClientOrigin();
  const [plantId, setPlantId] = useState(mockPlants[0]?.id ?? "");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const relativePath = useMemo(() => plantPagePath(plantId, locationId), [plantId, locationId]);
  const fullUrl = origin ? `${origin}${relativePath}` : "";

  const plant = mockPlants.find((p) => p.id === plantId);
  const location = locations.find((l) => l.id === locationId);

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
    const safePlant = plantId.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeLoc = locationId.replace(/[^a-zA-Z0-9_-]/g, "");
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `urban-plant-qr-${safePlant}-${safeLoc}.svg`;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        <h2 className="text-lg font-semibold text-emerald-950">Build QR URL</h2>
        <p className="mt-1 text-sm text-slate-600">
          The QR encodes a single public landing URL only (plant + location). No customer or private
          data is embedded.
        </p>

        <div className="mt-5 grid gap-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Plant</span>
            <select
              value={plantId}
              onChange={(e) => setPlantId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {mockPlants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({formatPrice(p.price, p.currency)})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-slate-700">Partner location</span>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} — {loc.partnerType}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="rounded-3xl bg-emerald-50/40 p-5">
        <h2 className="text-lg font-semibold text-emerald-950">Preview</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Plant</dt>
            <dd className="text-slate-900">{plant?.name ?? plantId}</dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Location</dt>
            <dd className="text-slate-900">{location?.name ?? locationId}</dd>
          </div>
          <div className="pt-2">
            <dt className="font-medium text-slate-500">Generated URL</dt>
            <dd className="mt-1 break-all rounded-xl bg-white px-3 py-2 font-mono text-xs text-slate-800 ring-1 ring-emerald-100">
              {fullUrl || `${relativePath} (full URL loads after page mounts)`}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => void handleCopyUrl()}
            disabled={!fullUrl}
            className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy URL
          </button>
          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={!fullUrl}
            className="rounded-xl border border-emerald-300 bg-white px-4 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download QR (SVG)
          </button>
          {copyHint ? <span className="self-center text-sm text-emerald-800">{copyHint}</span> : null}
        </div>

        <div className="mt-6 flex justify-center rounded-2xl bg-white p-6 ring-1 ring-emerald-100">
          <div ref={qrHostRef} className="w-full max-w-[240px]">
            {fullUrl ? (
              <QRCode
                value={fullUrl}
                size={240}
                style={{ height: "auto", maxWidth: "100%", width: "100%" }}
              />
            ) : (
              <div className="flex aspect-square items-center justify-center rounded-xl bg-emerald-50 text-center text-sm text-slate-600">
                Preparing QR…
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-slate-500">
        <Link href="/admin/orders" className="font-medium text-emerald-700 underline underline-offset-2">
          Back to orders
        </Link>
      </p>
    </div>
  );
}
