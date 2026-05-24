"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { PartnerLocation } from "@/lib/partnerLocationStorage";
import type { PartnerPaymentRecord } from "@/lib/partnerPayment";
import { posSpotPocketLabel } from "@/lib/posSpotPocket";
import type { PosSpot, PosSpotStatus } from "@/lib/posSpotTypes";
import { posSpotPath } from "@/lib/qrNavigation";

type PartnersApiResponse = {
  partners?: PartnerLocation[];
  partner?: PartnerLocation;
  error?: string;
};

type PosSpotsApiResponse = {
  posSpots?: PosSpot[];
  error?: string;
};

/** Editable payment row in partner create/edit forms. */
type PaymentDraft = {
  when_paid: string;
  how_much: string;
  who: string;
};

type PartnerDraft = {
  name: string;
  address: string;
  type: string;
  payments: PaymentDraft[];
};

function emptyPaymentDraft(): PaymentDraft {
  return { when_paid: "", how_much: "", who: "" };
}

function paymentToDraft(payment: PartnerPaymentRecord): PaymentDraft {
  return {
    when_paid: payment.when_paid,
    how_much: String(payment.how_much),
    who: payment.who,
  };
}

function normalizePartner(partner: PartnerLocation): PartnerLocation {
  return {
    ...partner,
    payments: Array.isArray(partner.payments) ? partner.payments : [],
  };
}

function normalizeDraft(draft: PartnerDraft): PartnerDraft {
  return {
    name: draft.name ?? "",
    address: draft.address ?? "",
    type: draft.type ?? "",
    payments: Array.isArray(draft.payments) ? draft.payments : [],
  };
}

function partnerToDraft(partner: PartnerLocation): PartnerDraft {
  const normalized = normalizePartner(partner);
  return {
    name: normalized.name,
    address: normalized.address,
    type: normalized.type,
    payments: normalized.payments.map(paymentToDraft),
  };
}

function emptyDraft(): PartnerDraft {
  return {
    name: "",
    address: "",
    type: "",
    payments: [],
  };
}

function paymentDraftIsEmpty(row: PaymentDraft): boolean {
  return !row.when_paid.trim() && !row.how_much.trim() && !row.who.trim();
}

function paymentDraftIsComplete(row: PaymentDraft): boolean {
  return Boolean(row.when_paid.trim() && row.how_much.trim() && row.who.trim());
}

function draftPaymentsToRecords(
  rows: PaymentDraft[],
): PartnerPaymentRecord[] | { error: string } {
  const records: PartnerPaymentRecord[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (paymentDraftIsEmpty(row)) continue;

    if (!paymentDraftIsComplete(row)) {
      return {
        error: `Payment ${i + 1}: fill when paid, amount, and who, or remove the row.`,
      };
    }

    const how_much = Number(row.how_much);
    if (!Number.isFinite(how_much) || how_much < 0) {
      return { error: `Payment ${i + 1}: amount must be a non-negative number.` };
    }

    records.push({
      when_paid: row.when_paid.trim(),
      how_much,
      who: row.who.trim(),
    });
  }

  return records;
}

function draftToPayload(draft: PartnerDraft):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string } {
  const normalized = normalizeDraft(draft);
  const payments = draftPaymentsToRecords(normalized.payments);
  if ("error" in payments) return { ok: false, error: payments.error };

  return {
    ok: true,
    payload: {
      name: normalized.name.trim(),
      address: normalized.address.trim(),
      type: normalized.type.trim(),
      payments,
    },
  };
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4l10.5-10.5a2.12 2.12 0 00-3-3L5 17v3zM14.5 6.5l3 3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function partnerMatchesSearch(
  partner: PartnerLocation,
  query: string,
  spots: PosSpot[] = [],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const payments = Array.isArray(partner.payments) ? partner.payments : [];
  const haystack = [
    partner.id,
    partner.name,
    partner.address,
    partner.type,
    ...payments.flatMap((p) => [p.who, p.when_paid, String(p.how_much)]),
    ...spots.flatMap((spot) => [
      spot.spotName,
      spot.posName,
      spot.spotSlug,
      spot.posNumber,
      posSpotPocketLabel(spot),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

function posSpotStatusLabel(status: PosSpotStatus): string {
  if (status === "available") return "Available";
  if (status === "sold") return "Unavailable";
  return "Inactive";
}

function posSpotStatusClassName(status: PosSpotStatus): string {
  if (status === "available") return "bg-emerald-100 text-emerald-800";
  if (status === "sold") return "bg-slate-100 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

function PartnerSpotsList({ spots }: { spots: PosSpot[] }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">POS spots</p>
      <div className="mt-1 text-sm">
        {spots.length === 0 ? (
          <span className="text-slate-900">None</span>
        ) : (
          <ul className="space-y-2">
            {spots.map((spot) => {
              const pocketLabel = posSpotPocketLabel(spot);
              return (
                <li
                  key={spot.id}
                  className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-emerald-950">{spot.spotName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${posSpotStatusClassName(spot.status)}`}
                    >
                      {posSpotStatusLabel(spot.status)}
                    </span>
                  </div>
                  <dl className="grid gap-1.5">
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-medium text-slate-500">Display name</dt>
                      <dd className="text-slate-900">{spot.posName}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-2">
                      <dt className="font-medium text-slate-500">Spot slug</dt>
                      <dd className="font-mono text-xs text-slate-900">{spot.spotSlug}</dd>
                    </div>
                    {spot.posNumber ? (
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">POS number</dt>
                        <dd className="text-slate-900">{spot.posNumber}</dd>
                      </div>
                    ) : null}
                    {pocketLabel ? (
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">Pocket</dt>
                        <dd className="text-slate-900">{pocketLabel}</dd>
                      </div>
                    ) : null}
                    {spot.spotDescription ? (
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">Description</dt>
                        <dd className="text-slate-900">{spot.spotDescription}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Link
                      href={posSpotPath(spot.spotSlug)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-emerald-700 underline underline-offset-2"
                    >
                      Open POS page
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

const inputClassName =
  "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900";
const labelClassName = "text-xs font-medium text-slate-500";

function PartnerPaymentsEditor({
  payments,
  onChange,
}: {
  payments: PaymentDraft[] | undefined;
  onChange: (payments: PaymentDraft[]) => void;
}) {
  const rows = Array.isArray(payments) ? payments : [];

  function updateRow(index: number, partial: Partial<PaymentDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...partial } : row)));
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div className="sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <span className={labelClassName}>Payments</span>
        <button
          type="button"
          onClick={() => onChange([...rows, emptyPaymentDraft()])}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
        >
          + Add payment
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No payments recorded yet.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {rows.map((row, index) => (
            <li
              key={index}
              className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  Payment {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-xs font-medium text-red-700 hover:underline"
                >
                  Remove
                </button>
              </div>
              <div className="grid gap-3">
                <label className="block">
                  <span className={labelClassName}>When paid</span>
                  <input
                    className={inputClassName}
                    type="date"
                    value={row.when_paid}
                    onChange={(e) => updateRow(index, { when_paid: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className={labelClassName}>Amount</span>
                  <input
                    className={inputClassName}
                    type="number"
                    min={0}
                    step={0.01}
                    value={row.how_much}
                    onChange={(e) => updateRow(index, { how_much: e.target.value })}
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <span className={labelClassName}>Who</span>
                  <input
                    className={inputClassName}
                    value={row.who}
                    onChange={(e) => updateRow(index, { who: e.target.value })}
                    placeholder="Paid to / by"
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PartnerFieldsForm({
  draft,
  onChange,
}: {
  draft: PartnerDraft;
  onChange: (next: PartnerDraft) => void;
}) {
  const safeDraft = normalizeDraft(draft);

  function patch(partial: Partial<PartnerDraft>) {
    onChange(normalizeDraft({ ...safeDraft, ...partial }));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Name</span>
          <input
            className={inputClassName}
            value={safeDraft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Address</span>
          <input
            className={inputClassName}
            value={safeDraft.address}
            onChange={(e) => patch({ address: e.target.value })}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>Type</span>
          <input
            className={inputClassName}
            value={safeDraft.type}
            onChange={(e) => patch({ type: e.target.value })}
            placeholder="Cafe"
          />
        </label>
        <PartnerPaymentsEditor
          payments={safeDraft.payments}
          onChange={(payments) => patch({ payments })}
        />
      </div>
    </div>
  );
}

function PartnerDetailView({
  partner,
  spots,
}: {
  partner: PartnerLocation;
  spots: PosSpot[];
}) {
  const payments = Array.isArray(partner.payments) ? partner.payments : [];

  return (
    <div>
      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Name</dt>
          <dd className="text-slate-900">{partner.name}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Address</dt>
          <dd className="text-slate-900">{partner.address}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">Type</dt>
          <dd className="text-slate-900">{partner.type}</dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">Payments</dt>
          <dd className="mt-1">
            {payments.length > 0 ? (
              <ul className="space-y-2">
                {payments.map((payment, index) => (
                  <li
                    key={`${payment.when_paid}-${payment.who}-${index}`}
                    className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-sm"
                  >
                    <dl className="grid gap-1.5">
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">When paid</dt>
                        <dd className="text-slate-900">{payment.when_paid}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">Amount</dt>
                        <dd className="text-slate-900">{payment.how_much}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">Who</dt>
                        <dd className="text-slate-900">{payment.who}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-slate-900">None</span>
            )}
          </dd>
        </div>
        {partner.createdAt ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">Created at</dt>
            <dd className="font-mono text-xs text-slate-900">{partner.createdAt}</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-4">
        <PartnerSpotsList spots={spots} />
      </div>
    </div>
  );
}

function AdminPartnerCard({
  partner,
  spots,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
}: {
  partner: PartnerLocation;
  spots: PosSpot[];
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (partner: PartnerLocation) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(() => partnerToDraft(partner));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setDraft(partnerToDraft(partner));
      setIsOpen(true);
      return;
    }
    setDraft(partnerToDraft(partner));
  }, [partner, isEditing]);

  async function handleSave() {
    const result = draftToPayload(draft);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/partners/${encodeURIComponent(partner.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.payload),
      });
      const data = (await res.json().catch(() => ({}))) as PartnersApiResponse;
      if (!res.ok) {
        setSaveError(data.error ?? "Could not save partner");
        return;
      }
      if (data.partner) onSaved(data.partner);
    } catch {
      setSaveError("Network error. Try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-3xl bg-white shadow-[0_8px_30px_rgba(15,23,42,0.04)]" id="partner-card">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50/80"
          aria-expanded={isOpen}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-emerald-950">
              {partner.name}
            </span>
            <span className="mt-0.5 block truncate text-sm text-slate-600">{partner.address}</span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              {partner.type}
              {spots.length > 0
                ? ` · ${spots.length} POS spot${spots.length === 1 ? "" : "s"}`
                : ""}
            </span>
          </span>
          <IconChevron className="h-5 w-5 shrink-0 text-slate-500" open={isOpen} />
        </button>
        {!isEditing ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
            className="flex w-12 shrink-0 items-center justify-center text-slate-700 transition hover:bg-slate-50"
            aria-label={`Edit ${partner.name}`}
          >
            <IconPencil className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {isOpen ? (
        <div className="border-t border-slate-100 px-4 pb-4 pt-4">
          {isEditing ? (
            <>
              <PartnerFieldsForm draft={draft} onChange={setDraft} />
              {saveError ? <p className="mt-3 text-sm text-red-700">{saveError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
                >
                  {isSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={isSaving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-6 border-t border-slate-100 pt-4">
                <PartnerSpotsList spots={spots} />
              </div>
            </>
          ) : (
            <PartnerDetailView partner={partner} spots={spots} />
          )}
        </div>
      ) : null}
    </article>
  );
}

function IconChevron({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      className={`${className ?? ""} transition-transform ${open ? "rotate-180" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AdminPartnersManager() {
  const [partners, setPartners] = useState<PartnerLocation[]>([]);
  const [posSpots, setPosSpots] = useState<PosSpot[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const spotsByPartnerId = useMemo(() => {
    const map = new Map<string, PosSpot[]>();
    for (const spot of posSpots) {
      const list = map.get(spot.partnerLocationId) ?? [];
      list.push(spot);
      map.set(spot.partnerLocationId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.spotName.localeCompare(b.spotName));
    }
    return map;
  }, [posSpots]);

  const filteredPartners = useMemo(
    () =>
      partners.filter((partner) =>
        partnerMatchesSearch(partner, searchQuery, spotsByPartnerId.get(partner.id) ?? []),
      ),
    [partners, searchQuery, spotsByPartnerId],
  );

  const loadPageData = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [partnersRes, spotsRes] = await Promise.all([
        fetch("/api/partners", { cache: "no-store", signal }),
        fetch("/api/pos-spots", { cache: "no-store", signal }),
      ]);
      const partnersData = (await partnersRes.json().catch(() => ({}))) as PartnersApiResponse;
      const spotsData = (await spotsRes.json().catch(() => ({}))) as PosSpotsApiResponse;
      if (signal?.aborted) return;
      if (!partnersRes.ok) {
        setLoadError(partnersData.error ?? "Could not load partners");
        setPartners([]);
        setPosSpots([]);
        return;
      }
      if (!spotsRes.ok) {
        setLoadError(spotsData.error ?? "Could not load POS spots");
        setPartners([]);
        setPosSpots([]);
        return;
      }
      setPartners((partnersData.partners ?? []).map(normalizePartner));
      setPosSpots(spotsData.posSpots ?? []);
    } catch {
      if (signal?.aborted) return;
      setLoadError("Network error while loading partners");
      setPartners([]);
      setPosSpots([]);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPageData(controller.signal);
    return () => controller.abort();
  }, [loadPageData]);

  async function handleCreate() {
    const result = draftToPayload(createDraft);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.payload),
      });
      const data = (await res.json().catch(() => ({}))) as PartnersApiResponse;
      if (!res.ok) {
        setCreateError(data.error ?? "Could not create partner");
        return;
      }
      setShowCreate(false);
      setCreateDraft(emptyDraft());
      await loadPageData();
    } catch {
      setCreateError("Network error. Try again.");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Urban Plant · Admin
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-emerald-950">Partners</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="text-sm font-medium text-emerald-700 underline underline-offset-2"
          >
            Admin
          </Link>
          <button
            type="button"
            onClick={() => {
              setShowCreate((open) => !open);
              setCreateError(null);
              if (showCreate) setCreateDraft(emptyDraft());
            }}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
            aria-expanded={showCreate}
            aria-label={showCreate ? "Close create partner form" : "Create partner"}
          >
            <IconPlus className="h-6 w-6" />
          </button>
        </div>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        Partner locations used for POS spots and checkout. Changes are saved to the database.
      </p>

      {showCreate ? (
        <section className="mb-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <h2 className="mb-4 text-base font-semibold text-emerald-950">New partner</h2>
          <PartnerFieldsForm draft={createDraft} onChange={setCreateDraft} />
          {createError ? <p className="mt-3 text-sm text-red-700">{createError}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={isCreating}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {isCreating ? "Creating…" : "Create partner"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setCreateDraft(emptyDraft());
                setCreateError(null);
              }}
              disabled={isCreating}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {!isLoading && !loadError && partners.length > 0 ? (
        <label className="mb-4 block">
          <span className="sr-only">Search partners</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, address, type…"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </label>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-600">Loading partners…</p>
      ) : loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : partners.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">No partners yet.</p>
      ) : filteredPartners.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          No partners match &ldquo;{searchQuery.trim()}&rdquo;.
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredPartners.map((partner) => (
            <li key={partner.id}>
              <AdminPartnerCard
                partner={partner}
                spots={spotsByPartnerId.get(partner.id) ?? []}
                isEditing={editingId === partner.id}
                onStartEdit={() => {
                  setEditingId(partner.id);
                  setShowCreate(false);
                }}
                onCancelEdit={() => setEditingId(null)}
                onSaved={(updated) => {
                  setPartners((prev) =>
                    prev.map((item) =>
                      item.id === updated.id ? normalizePartner(updated) : item,
                    ),
                  );
                  setEditingId(null);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}