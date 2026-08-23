"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { StreetSearchSelect } from "@/components/checkout/StreetSearchSelect";
import { useLocale } from "@/components/locale/LocaleProvider";
import { adminCheckboxClassName } from "@/components/admin/shared/adminSelectionStyles";
import { displayApiError } from "@/lib/displayLabels";
import {
  formatDeliveryAddressLine,
  formatStoredDeliveryAddressDisplay,
  isTelAvivStreet,
  parseStoredDeliveryAddress,
} from "@/lib/deliveryAddress";
import type { Locale } from "@/lib/locale";
import { t } from "@/lib/messages";
import type { PartnerLocation } from "@/lib/partnerLocationStorage";
import type { PartnerPaymentRecord } from "@/lib/partnerPayment";
import { posSpotPocketLabel } from "@/lib/posSpotPocket";
import type { PosSpot } from "@/lib/posSpotTypes";
import { comparePosSpotsByPosNumberAsc } from "@/lib/posSpotSort";
import { routes } from "@/lib/routes";

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
  street: string;
  houseNumber: string;
  type: string;
  pickupDisabled: boolean;
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
    pickupDisabled: Boolean(partner.pickupDisabled),
    payments: Array.isArray(partner.payments) ? partner.payments : [],
  };
}

function normalizeDraft(draft: PartnerDraft): PartnerDraft {
  return {
    name: draft.name ?? "",
    street: draft.street ?? "",
    houseNumber: draft.houseNumber ?? "",
    type: draft.type ?? "",
    pickupDisabled: Boolean(draft.pickupDisabled),
    payments: Array.isArray(draft.payments) ? draft.payments : [],
  };
}

function partnerToDraft(partner: PartnerLocation): PartnerDraft {
  const normalized = normalizePartner(partner);
  const { street, houseNumber } = parseStoredDeliveryAddress(normalized.address);
  return {
    name: normalized.name,
    street,
    houseNumber,
    type: normalized.type,
    pickupDisabled: normalized.pickupDisabled,
    payments: normalized.payments.map(paymentToDraft),
  };
}

function emptyDraft(): PartnerDraft {
  return {
    name: "",
    street: "",
    houseNumber: "",
    type: "",
    pickupDisabled: false,
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
  locale: Locale,
): PartnerPaymentRecord[] | { error: string } {
  const records: PartnerPaymentRecord[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (paymentDraftIsEmpty(row)) continue;

    if (!paymentDraftIsComplete(row)) {
      return {
        error: t(locale, "admin.partners.validation.paymentIncomplete", { n: i + 1 }),
      };
    }

    const how_much = Number(row.how_much);
    if (!Number.isFinite(how_much) || how_much < 0) {
      return {
        error: t(locale, "admin.partners.validation.paymentAmount", { n: i + 1 }),
      };
    }

    records.push({
      when_paid: row.when_paid.trim(),
      how_much,
      who: row.who.trim(),
    });
  }

  return records;
}

function draftToPayload(
  draft: PartnerDraft,
  locale: Locale,
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string } {
  const normalized = normalizeDraft(draft);
  const payments = draftPaymentsToRecords(normalized.payments, locale);
  if ("error" in payments) return { ok: false, error: payments.error };

  const street = normalized.street.trim();
  const houseNumber = normalized.houseNumber.trim();
  if (!street) {
    return { ok: false, error: t(locale, "admin.partners.validation.streetRequired") };
  }
  if (!houseNumber) {
    return { ok: false, error: t(locale, "admin.partners.validation.houseRequired") };
  }
  if (!isTelAvivStreet(street)) {
    return { ok: false, error: t(locale, "admin.partners.validation.streetTelAviv") };
  }

  return {
    ok: true,
    payload: {
      name: normalized.name.trim(),
      address: formatDeliveryAddressLine({ street, houseNumber }),
      type: normalized.type.trim(),
      pickupDisabled: normalized.pickupDisabled,
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
  const locale = useLocale();
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
        <span className={labelClassName}>{t(locale, "admin.partners.payments")}</span>
        <button
          type="button"
          onClick={() => onChange([...rows, emptyPaymentDraft()])}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
        >
          {t(locale, "admin.partners.addPayment")}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">{t(locale, "admin.partners.noPayments")}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {rows.map((row, index) => (
            <li
              key={index}
              className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  {t(locale, "admin.partners.paymentN", { n: index + 1 })}
                </span>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-xs font-medium text-red-700 hover:underline"
                >
                  {t(locale, "admin.common.remove")}
                </button>
              </div>
              <div className="grid gap-3">
                <label className="block">
                  <span className={labelClassName}>{t(locale, "admin.partners.whenPaid")}</span>
                  <input
                    className={inputClassName}
                    type="date"
                    value={row.when_paid}
                    onChange={(e) => updateRow(index, { when_paid: e.target.value })}
                  />
                </label>
                <label className="block">
                  <span className={labelClassName}>{t(locale, "admin.partners.amount")}</span>
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
                  <span className={labelClassName}>{t(locale, "admin.partners.who")}</span>
                  <input
                    className={inputClassName}
                    value={row.who}
                    onChange={(e) => updateRow(index, { who: e.target.value })}
                    placeholder={t(locale, "admin.partners.whoPlaceholder")}
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
  const locale = useLocale();
  const safeDraft = normalizeDraft(draft);

  function patch(partial: Partial<PartnerDraft>) {
    onChange(normalizeDraft({ ...safeDraft, ...partial }));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.common.name")}</span>
          <input
            className={inputClassName}
            value={safeDraft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <div className="space-y-4 sm:col-span-2">
          <div>
            <span className={labelClassName}>{t(locale, "checkout.address.city")}</span>
            <input
              className={`${inputClassName} cursor-default bg-slate-50 text-slate-700`}
              value={t(locale, "checkout.city.telAviv")}
              readOnly
              aria-readonly="true"
            />
          </div>
          <div>
            <label className={labelClassName} htmlFor="partner-street">
              {t(locale, "checkout.address.street")}
            </label>
            <div className="mt-1">
              <StreetSearchSelect
                id="partner-street"
                value={safeDraft.street}
                onChange={(street) => patch({ street })}
              />
            </div>
          </div>
          <label className="block">
            <span className={labelClassName}>{t(locale, "checkout.address.houseNumber")}</span>
            <input
              className={inputClassName}
              value={safeDraft.houseNumber}
              onChange={(e) => patch({ houseNumber: e.target.value })}
              placeholder="26ב"
              autoComplete="off"
            />
          </label>
        </div>
        <label className="block sm:col-span-2">
          <span className={labelClassName}>{t(locale, "admin.partners.type")}</span>
          <input
            className={inputClassName}
            value={safeDraft.type}
            onChange={(e) => patch({ type: e.target.value })}
            placeholder={t(locale, "admin.partners.typePlaceholder")}
          />
        </label>
        <label className="flex items-start gap-3 sm:col-span-2">
          <input
            type="checkbox"
            className={`mt-1 ${adminCheckboxClassName}`}
            checked={safeDraft.pickupDisabled}
            onChange={(e) => patch({ pickupDisabled: e.target.checked })}
          />
          <span>
            <span className={labelClassName}>{t(locale, "admin.partners.disablePickup")}</span>
            <span className="mt-1 block text-sm text-slate-600">
              {t(locale, "admin.partners.disablePickupHint")}
            </span>
          </span>
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
}: {
  partner: PartnerLocation;
}) {
  const locale = useLocale();
  const payments = Array.isArray(partner.payments) ? partner.payments : [];

  return (
    <div>
      <dl className="mt-4 grid gap-2 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.common.name")}</dt>
          <dd className="text-slate-900">{partner.name}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.common.address")}</dt>
          <dd className="text-slate-900">
            {formatStoredDeliveryAddressDisplay(partner.address, locale)}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">{t(locale, "admin.partners.type")}</dt>
          <dd className="text-slate-900">{partner.type}</dd>
        </div>
        <div className="flex flex-wrap gap-x-2">
          <dt className="font-medium text-slate-500">
            {t(locale, "admin.partners.pickupAtCheckout")}
          </dt>
          <dd className="text-slate-900">
            {partner.pickupDisabled
              ? t(locale, "admin.partners.pickupDisabled")
              : t(locale, "admin.partners.pickupEnabled")}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-500">{t(locale, "admin.partners.payments")}</dt>
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
                        <dt className="font-medium text-slate-500">
                          {t(locale, "admin.partners.whenPaid")}
                        </dt>
                        <dd className="text-slate-900">{payment.when_paid}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">
                          {t(locale, "admin.partners.amount")}
                        </dt>
                        <dd className="text-slate-900">{payment.how_much}</dd>
                      </div>
                      <div className="flex flex-wrap gap-x-2">
                        <dt className="font-medium text-slate-500">
                          {t(locale, "admin.partners.who")}
                        </dt>
                        <dd className="text-slate-900">{payment.who}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-slate-900">{t(locale, "admin.common.none")}</span>
            )}
          </dd>
        </div>
        {partner.createdAt ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-slate-500">{t(locale, "admin.common.createdAt")}</dt>
            <dd className="font-mono text-xs text-slate-900">{partner.createdAt}</dd>
          </div>
        ) : null}
      </dl>
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
  const locale = useLocale();
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
    const result = draftToPayload(draft, locale);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(routes.api.partner(partner.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.payload),
      });
      const data = (await res.json().catch(() => ({}))) as PartnersApiResponse;
      if (!res.ok) {
        setSaveError(displayApiError(locale, data.error, "admin.partners.saveFailed"));
        return;
      }
      if (data.partner) onSaved(data.partner);
    } catch {
      setSaveError(t(locale, "common.networkError"));
    } finally {
      setIsSaving(false);
    }
  }

  const spotCountLabel =
    spots.length === 1
      ? t(locale, "admin.partners.posSpotCountOne")
      : spots.length > 1
        ? t(locale, "admin.partners.posSpotCountMany", { count: spots.length })
        : "";

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
            <span className="mt-0.5 block truncate text-sm text-slate-600">
              {formatStoredDeliveryAddressDisplay(partner.address, locale)}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-500">
              {partner.type}
              {spotCountLabel ? ` · ${spotCountLabel}` : ""}
            </span>
          </span>
          <IconChevron className="h-5 w-5 shrink-0 text-slate-500" open={isOpen} />
        </button>
        {!isEditing ? (
          <div className="flex shrink-0">
            <Link
              href={routes.admin.partner(partner.id)}
              className="flex items-center px-3 text-xs font-semibold text-emerald-700 transition hover:bg-slate-50"
              onClick={(e) => e.stopPropagation()}
            >
              {t(locale, "admin.common.manage")}
            </Link>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              className="flex w-12 shrink-0 items-center justify-center text-slate-700 transition hover:bg-slate-50"
              aria-label={t(locale, "admin.partners.editAria", { name: partner.name })}
            >
              <IconPencil className="h-5 w-5" />
            </button>
          </div>
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
                  {isSaving ? t(locale, "admin.shared.saving") : t(locale, "admin.shared.save")}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  disabled={isSaving}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {t(locale, "admin.shared.cancel")}
                </button>
              </div>
            </>
          ) : (
            <PartnerDetailView partner={partner} />
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
  const locale = useLocale();
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
      list.sort(comparePosSpotsByPosNumberAsc);
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
        fetch(routes.api.partners(), { cache: "no-store", signal }),
        fetch(routes.api.posSpots(), { cache: "no-store", signal }),
      ]);
      const partnersData = (await partnersRes.json().catch(() => ({}))) as PartnersApiResponse;
      const spotsData = (await spotsRes.json().catch(() => ({}))) as PosSpotsApiResponse;
      if (signal?.aborted) return;
      if (!partnersRes.ok) {
        setLoadError(displayApiError(locale, partnersData.error, "admin.partners.loadFailed"));
        setPartners([]);
        setPosSpots([]);
        return;
      }
      if (!spotsRes.ok) {
        setLoadError(displayApiError(locale, spotsData.error, "admin.partners.loadSpotsFailed"));
        setPartners([]);
        setPosSpots([]);
        return;
      }
      setPartners((partnersData.partners ?? []).map(normalizePartner));
      setPosSpots(spotsData.posSpots ?? []);
    } catch {
      if (signal?.aborted) return;
      setLoadError(t(locale, "admin.partners.networkLoad"));
      setPartners([]);
      setPosSpots([]);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    const controller = new AbortController();
    void loadPageData(controller.signal);
    return () => controller.abort();
  }, [loadPageData]);

  async function handleCreate() {
    const result = draftToPayload(createDraft, locale);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(routes.api.partners(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.payload),
      });
      const data = (await res.json().catch(() => ({}))) as PartnersApiResponse;
      if (!res.ok) {
        setCreateError(displayApiError(locale, data.error, "admin.partners.createFailed"));
        return;
      }
      setShowCreate(false);
      setCreateDraft(emptyDraft());
      await loadPageData();
    } catch {
      setCreateError(t(locale, "common.networkError"));
    } finally {
      setIsCreating(false);
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
        <div className="flex items-center gap-2">
          <Link
            href={routes.admin.index()}
            className="text-sm font-medium text-emerald-700 underline underline-offset-2"
          >
            {t(locale, "admin.common.admin")}
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
            aria-label={
              showCreate
                ? t(locale, "admin.partners.createToggleClose")
                : t(locale, "admin.partners.createToggleOpen")
            }
          >
            <IconPlus className="h-6 w-6" />
          </button>
        </div>
      </div>

      <p className="mb-6 text-sm leading-relaxed text-slate-600">
        {t(locale, "admin.partners.intro")}
      </p>

      {showCreate ? (
        <section className="mb-6 rounded-3xl bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
          <h2 className="mb-4 text-base font-semibold text-emerald-950">
            {t(locale, "admin.partners.new")}
          </h2>
          <PartnerFieldsForm draft={createDraft} onChange={setCreateDraft} />
          {createError ? <p className="mt-3 text-sm text-red-700">{createError}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={isCreating}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
            >
              {isCreating
                ? t(locale, "admin.common.creating")
                : t(locale, "admin.partners.create")}
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
              {t(locale, "admin.shared.cancel")}
            </button>
          </div>
        </section>
      ) : null}

      {!isLoading && !loadError && partners.length > 0 ? (
        <label className="mb-4 block">
          <span className="sr-only">{t(locale, "admin.partners.searchAria")}</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t(locale, "admin.partners.searchPlaceholder")}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/25"
          />
        </label>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-slate-600">{t(locale, "admin.partners.loading")}</p>
      ) : loadError ? (
        <p className="text-sm text-red-700">{loadError}</p>
      ) : partners.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          {t(locale, "admin.partners.empty")}
        </p>
      ) : filteredPartners.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-slate-600">
          {t(locale, "admin.partners.noMatch", { query: searchQuery.trim() })}
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
