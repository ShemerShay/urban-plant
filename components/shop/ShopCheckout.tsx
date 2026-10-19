"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { CheckoutCustomerFields } from "@/components/checkout/CheckoutCustomerFields";
import { CheckoutEmailOptIn } from "@/components/checkout/CheckoutEmailOptIn";
import { DeliveryAddressFields } from "@/components/checkout/DeliveryAddressFields";
import { useLocale } from "@/components/locale/LocaleProvider";
import { ShopSoftSpinner } from "@/components/shop/ShopSoftSpinner";
import {
  catalogCartItemsEqual,
  catalogCartLineAmount,
  storedCatalogCartItems,
  type CatalogCartItem,
  type CatalogCartResolvedLine,
} from "@/lib/catalogCart";
import {
  catalogCheckoutLinesMatch,
  catalogCheckoutPaymentFailure,
  catalogCheckoutPaymentLines,
  catalogCheckoutSnapshotItems,
  claimCatalogCheckoutSubmit,
  releaseCatalogCheckoutSubmit,
  type CatalogCheckoutResume,
} from "@/lib/catalogCheckoutFlow";
import { rememberCatalogCheckoutSnapshot } from "@/lib/catalogCheckoutSession";
import { useCatalogCart, writeCatalogCart } from "@/lib/catalogCartStore";
import { formatCatalogPrice } from "@/lib/catalogPriceFormat";
import {
  canSubmitCheckout,
  getCheckoutFieldErrors,
  getVisibleCheckoutFieldErrors,
  type CheckoutFieldKey,
  type CheckoutFormValues,
} from "@/lib/checkoutValidation";
import { displayApiError, translateCheckoutFieldErrors } from "@/lib/displayLabels";
import { localizedPlantText } from "@/lib/plantDisplay";
import { t } from "@/lib/messages";
import { routes } from "@/lib/routes";
import type { Locale } from "@/lib/locale";

const ctaClass =
  "text-body flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-4 text-center font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55 focus-visible:ring-offset-2";
const ctaEnabled =
  "bg-brand text-white shadow-[0_6px_18px_rgba(27,67,50,0.14)] transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600 disabled:shadow-none";
const cardClass =
  "rounded-[28px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]";
const emailInputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-body text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200/60";

const EMPTY_FIELDS: CheckoutFormValues = {
  fullName: "",
  email: "",
  phone: "",
  deliveryStreet: "",
  deliveryHouseNumber: "",
  apartmentOrNotes: "",
};

async function fetchResolvedCart(
  items: CatalogCartItem[],
): Promise<CatalogCartResolvedLine[] | null> {
  try {
    const response = await fetch(routes.api.shopCartResolve(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { items?: CatalogCartResolvedLine[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return null;
  }
}

function DeliveryFeeRow({ locale, currency }: { locale: Locale; currency: "ILS" | "USD" | "EUR" }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4">
      <span className="text-body text-neutral-600">{t(locale, "shop.deliveryFee")}</span>
      <span className="text-body text-foreground">{formatCatalogPrice(0, currency, locale)}</span>
    </div>
  );
}

type SummaryViewLine = {
  key: string;
  name: string;
  sizeLabel?: string;
  quantity: number;
  plantPrice: string;
  pot?: string;
  lineTotal: string;
};

function SummaryLineList({ locale, lines }: { locale: Locale; lines: SummaryViewLine[] }) {
  return (
    <ul className="flex flex-col gap-5">
      {lines.map((line) => (
        <li key={line.key}>
          <p className="text-body font-medium text-foreground">{line.name}</p>
          {line.sizeLabel ? (
            <p className="text-caption mt-1 text-neutral-600">{line.sizeLabel}</p>
          ) : null}
          <p className="text-caption mt-1 text-neutral-600">
            {t(locale, "shop.cartQuantity")} {line.quantity}
          </p>
          <p className="text-caption mt-1 text-neutral-600">{line.plantPrice}</p>
          {line.pot ? <p className="text-caption mt-1 text-neutral-600">{line.pot}</p> : null}
          <p className="text-body mt-2 font-medium text-foreground">{line.lineTotal}</p>
        </li>
      ))}
    </ul>
  );
}

function OrderSummary({
  locale,
  currency,
  total,
  lines,
}: {
  locale: Locale;
  currency: "ILS" | "USD" | "EUR";
  total: string;
  lines: SummaryViewLine[];
}) {
  const title = t(locale, "shop.orderSummary");
  const totalText = `${t(locale, "shop.cartTotal")} ${total}`;
  const body = (
    <>
      <SummaryLineList locale={locale} lines={lines} />
      <DeliveryFeeRow locale={locale} currency={currency} />
      <p className="text-heading-sm mt-3 font-medium text-foreground">{totalText}</p>
    </>
  );
  return (
    <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
      <details className={`${cardClass} group lg:hidden`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
          <span className="text-heading-sm inline-flex items-center gap-2 font-medium text-foreground">
            {title}
            <svg
              className="size-4 shrink-0 text-neutral-500 transition-transform group-open:rotate-180"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              aria-hidden
            >
              <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-body font-medium text-foreground">{total}</span>
        </summary>
        <div className="mt-5">{body}</div>
      </details>
      <section
        className={`${cardClass} hidden lg:sticky lg:top-8 lg:block`}
        aria-labelledby="shop-checkout-summary"
      >
        <h1 id="shop-checkout-summary" className="text-heading-sm font-medium text-foreground">
          {title}
        </h1>
        <div className="mt-5">{body}</div>
      </section>
    </div>
  );
}

function resumeSummaryLines(locale: Locale, resume: CatalogCheckoutResume): SummaryViewLine[] {
  return resume.lines.map((line) => ({
    key: line.key,
    name: localizedPlantText(locale, line.name, line.nameHe ?? undefined),
    ...(line.sizeLabel ? { sizeLabel: line.sizeLabel } : {}),
    quantity: line.quantity,
    plantPrice: formatCatalogPrice(line.plantPrice, line.currency, locale),
    ...(line.potPrice != null
      ? {
          pot: `${[line.potName, line.potColor].filter(Boolean).join(" ")} ${formatCatalogPrice(line.potPrice, line.currency, locale)}`.trim(),
        }
      : {}),
    lineTotal: formatCatalogPrice(line.lineTotal, line.currency, locale),
  }));
}

export function ShopCheckout({
  resume,
  paymentFailed,
}: {
  resume: CatalogCheckoutResume | null;
  paymentFailed: boolean;
}) {
  const locale = useLocale();
  const cart = useCatalogCart();
  const formRef = useRef<HTMLFormElement>(null);
  const submitGuard = useRef({ busy: false });
  const resolvedKeyRef = useRef("");
  const statusId = useId();
  const [lines, setLines] = useState<CatalogCartResolvedLine[]>([]);
  const [loading, setLoading] = useState(resume == null);
  const [loadError, setLoadError] = useState(false);
  const [fields, setFields] = useState<CheckoutFormValues>(EMPTY_FIELDS);
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<CheckoutFieldKey, boolean>>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [notice, setNotice] = useState<"cart_changed" | "insufficient_stock" | null>(null);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    if (resume) return;
    const requestKey = JSON.stringify(cart.items);
    if (cart.items.length === 0) {
      resolvedKeyRef.current = "[]";
      setLines([]);
      setLoading(false);
      setLoadError(false);
      return;
    }
    if (requestKey === resolvedKeyRef.current) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      const next = await fetchResolvedCart(cart.items);
      if (cancelled) return;
      if (!next) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      const stored = storedCatalogCartItems(next);
      resolvedKeyRef.current = JSON.stringify(stored);
      setLines(next);
      setLoading(false);
      if (!catalogCartItemsEqual(cart.items, stored)) {
        writeCatalogCart({ v: 1, items: stored });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cart.items, resume]);

  async function refreshResolved(): Promise<CatalogCartResolvedLine[] | null> {
    const next = await fetchResolvedCart(cart.items);
    if (!next) return null;
    const stored = storedCatalogCartItems(next);
    resolvedKeyRef.current = JSON.stringify(stored);
    setLines(next);
    if (!catalogCartItemsEqual(cart.items, stored)) {
      writeCatalogCart({ v: 1, items: stored });
    }
    return next;
  }

  async function onResumeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resume) return;
    if (!claimCatalogCheckoutSubmit(submitGuard.current)) return;
    setSubmitting(true);
    setRetryError(null);
    let redirected = false;
    try {
      const response = await fetch(routes.api.cardcomRetry(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: resume.orderId,
          resumeToken: resume.resumeToken,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        paymentUrl?: string;
      };
      if (!response.ok || !data.paymentUrl) {
        setRetryError(displayApiError(locale, data.error, "checkout.error.restartPayment"));
        return;
      }
      redirected = true;
      window.location.assign(data.paymentUrl);
    } catch {
      setRetryError(t(locale, "common.networkError"));
    } finally {
      if (!redirected) {
        releaseCatalogCheckoutSubmit(submitGuard.current);
        setSubmitting(false);
      }
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reviewRequired) return;
    const rules = { emailOptIn };
    if (!canSubmitCheckout(fields, "delivery", rules)) {
      setShowAllErrors(true);
      window.setTimeout(() => {
        formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      }, 0);
      return;
    }
    if (!claimCatalogCheckoutSubmit(submitGuard.current)) return;
    setSubmitting(true);
    setSubmitError(null);
    setNotice(null);
    let redirected = false;
    try {
      const fresh = await fetchResolvedCart(cart.items);
      if (!fresh) {
        setSubmitError(t(locale, "common.networkError"));
        return;
      }
      if (!catalogCheckoutLinesMatch(lines, fresh)) {
        const stored = storedCatalogCartItems(fresh);
        resolvedKeyRef.current = JSON.stringify(stored);
        setLines(fresh);
        if (!catalogCartItemsEqual(cart.items, stored)) {
          writeCatalogCart({ v: 1, items: stored });
        }
        setNotice("cart_changed");
        setReviewRequired(true);
        return;
      }

      const paymentLines = catalogCheckoutPaymentLines(fresh);
      if (!paymentLines) {
        setSubmitError(t(locale, "checkout.error.startPayment"));
        return;
      }

      const response = await fetch(routes.api.shopCheckout(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: paymentLines,
          emailOptIn,
          fullName: fields.fullName.trim(),
          phone: fields.phone.trim(),
          customerEmail: emailOptIn ? fields.email.trim() : "",
          deliveryStreet: fields.deliveryStreet.trim(),
          deliveryHouseNumber: fields.deliveryHouseNumber.trim(),
          apartmentOrNotes: fields.apartmentOrNotes.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        paymentUrl?: string;
        attemptId?: string;
        orderId?: string;
      };
      if (!response.ok || !data.paymentUrl) {
        const failure = catalogCheckoutPaymentFailure(data.code);
        if (failure.refreshCart) {
          await refreshResolved();
        }
        if (failure.notice) {
          setNotice(failure.notice);
          setReviewRequired(failure.reviewRequired);
          return;
        }
        setSubmitError(displayApiError(locale, data.error, "checkout.error.startPayment"));
        return;
      }

      const attemptId = (data.attemptId || data.orderId || "").trim();
      if (attemptId) {
        rememberCatalogCheckoutSnapshot({
          attemptId,
          items: catalogCheckoutSnapshotItems(fresh),
        });
      }
      redirected = true;
      window.location.assign(data.paymentUrl);
    } catch {
      setSubmitError(t(locale, "common.networkError"));
    } finally {
      if (!redirected) {
        releaseCatalogCheckoutSubmit(submitGuard.current);
        setSubmitting(false);
      }
    }
  }

  if (resume) {
    return (
      <div className="grid w-full items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <OrderSummary
          locale={locale}
          currency={resume.currency}
          total={formatCatalogPrice(resume.amount, resume.currency, locale)}
          lines={resumeSummaryLines(locale, resume)}
        />
        <section className={`${cardClass} lg:col-start-1 lg:row-start-1`}>
          <h2 className="text-heading-sm font-medium text-foreground">
            {t(locale, "checkout.details.delivery")}
          </h2>
          <dl className="text-body mt-4 space-y-2 text-neutral-700">
            <div>
              <dt className="text-caption text-neutral-600">{t(locale, "checkout.field.fullName")}</dt>
              <dd>{resume.fullName}</dd>
            </div>
            <div>
              <dt className="text-caption text-neutral-600">{t(locale, "checkout.field.phone")}</dt>
              <dd>{resume.phone}</dd>
            </div>
            <div>
              <dt className="text-caption text-neutral-600">{t(locale, "checkout.address.legend")}</dt>
              <dd>{resume.address}</dd>
            </div>
            {resume.apartmentOrNotes ? (
              <div>
                <dt className="text-caption text-neutral-600">{t(locale, "checkout.address.notes")}</dt>
                <dd>{resume.apartmentOrNotes}</dd>
              </div>
            ) : null}
            {resume.email ? (
              <div>
                <dt className="text-caption text-neutral-600">{t(locale, "checkout.field.email")}</dt>
                <dd>{resume.email}</dd>
              </div>
            ) : null}
          </dl>
        </section>
        <form
          onSubmit={onResumeSubmit}
          className="space-y-4 lg:col-start-1 lg:row-start-2"
          aria-busy={submitting || undefined}
        >
          <p className="text-body text-neutral-600">{t(locale, "shop.resumePaymentNote")}</p>
          {resume.showPaymentFailed ? (
            <p id={statusId} role="alert" className="text-body font-medium text-red-800">
              {t(locale, "checkout.paymentFailed")}
            </p>
          ) : null}
          {retryError ? (
            <p role="alert" className="text-body font-medium text-red-800">
              {retryError}
            </p>
          ) : null}
          <button type="submit" className={`${ctaClass} ${ctaEnabled}`} disabled={submitting}>
            {submitting ? t(locale, "checkout.processing") : t(locale, "shop.continuePayment")}
          </button>
          {retryError ? (
            <Link
              href={routes.shop.checkout()}
              className="text-body block text-center font-medium text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
            >
              {t(locale, "shop.startNewCheckout")}
            </Link>
          ) : null}
        </form>
      </div>
    );
  }

  const rules = { emailOptIn };
  const fieldErrors = getCheckoutFieldErrors(fields, "delivery", rules);
  const errors = translateCheckoutFieldErrors(
    locale,
    getVisibleCheckoutFieldErrors(fieldErrors, touched, showAllErrors),
  );
  const currency = lines[0]?.currency ?? "ILS";
  const merchandise = lines.reduce(
    (sum, line) => sum + catalogCartLineAmount(line.plantPrice, line.potPrice, line.quantity),
    0,
  );
  const submitLocked = submitting || loading || loadError;

  return (
    <div className="grid w-full items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {loading ? (
        <ShopSoftSpinner label={t(locale, "common.loading")} className="min-h-40 lg:col-span-2" />
      ) : loadError ? (
        <p className={`${cardClass} text-body text-neutral-600 lg:col-span-2`} role="alert">
          {t(locale, "common.networkError")}
        </p>
      ) : lines.length === 0 ? (
        <section className={`${cardClass} lg:col-span-2`}>
          <h1 className="text-heading-sm font-medium text-foreground">
            {t(locale, "shop.checkoutEmpty")}
          </h1>
          {notice ? (
            <p role="alert" className="text-body mt-3 font-medium text-red-800">
              {t(locale, notice === "cart_changed" ? "shop.cartChanged" : "shop.insufficientStock")}
            </p>
          ) : null}
          <Link
            href={routes.shop.index()}
            className="text-body mt-4 inline-block font-medium text-brand-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/55"
          >
            {t(locale, "shop.backToShop")}
          </Link>
        </section>
      ) : (
        <OrderSummary
          locale={locale}
          currency={currency}
          total={formatCatalogPrice(merchandise, currency, locale)}
          lines={lines.map((line) => {
            const potColor = localizedPlantText(locale, line.potColor, line.potColorHe);
            const lineTotal = catalogCartLineAmount(line.plantPrice, line.potPrice, line.quantity);
            return {
              key: `${line.plantId}:${line.plantVariantId}:${line.potVariantId ?? ""}`,
              name: localizedPlantText(locale, line.name, line.nameHe),
              ...(line.sizeLabel ? { sizeLabel: line.sizeLabel } : {}),
              quantity: line.quantity,
              plantPrice: formatCatalogPrice(line.plantPrice, line.currency, locale),
              ...(line.potPrice != null
                ? {
                    pot: `${potColor || localizedPlantText(locale, line.potName, line.potNameHe)} ${formatCatalogPrice(line.potPrice, line.currency, locale)}`.trim(),
                  }
                : {}),
              lineTotal: formatCatalogPrice(lineTotal, line.currency, locale),
            };
          })}
        />
      )}

      {lines.length > 0 ? (
        <form
          id="shop-checkout-form"
          ref={formRef}
          onSubmit={onSubmit}
          className={`${cardClass} space-y-4 lg:col-start-1 lg:row-start-1`}
          noValidate
          aria-busy={submitting || undefined}
        >
          <h2 className="text-heading-sm font-medium text-foreground">
            {t(locale, "checkout.details.delivery")}
          </h2>
          {paymentFailed ? (
            <p role="alert" className="text-body font-medium text-red-800">
              {t(locale, "checkout.paymentFailed")}
            </p>
          ) : null}
          {notice ? (
            <p id={statusId} role="alert" className="text-body font-medium text-red-800">
              {t(locale, notice === "cart_changed" ? "shop.cartChanged" : "shop.insufficientStock")}
            </p>
          ) : null}
          {submitError ? (
            <p role="alert" className="text-body font-medium text-red-800">
              {submitError}
            </p>
          ) : null}
          <CheckoutCustomerFields
            values={fields}
            errors={errors}
            show={{ email: false }}
            onChange={(field, value) => setFields((current) => ({ ...current, [field]: value }))}
            onFieldBlur={(field) => setTouched((current) => ({ ...current, [field]: true }))}
          />
          <DeliveryAddressFields
            values={fields}
            errors={{
              deliveryStreet: errors.deliveryStreet,
              deliveryHouseNumber: errors.deliveryHouseNumber,
            }}
            onChange={(field, value) => setFields((current) => ({ ...current, [field]: value }))}
            onFieldBlur={(field) => setTouched((current) => ({ ...current, [field]: true }))}
          />
          <CheckoutEmailOptIn
            checked={emailOptIn}
            onChange={setEmailOptIn}
            disabled={submitting}
          />
          {emailOptIn ? (
            <div className="space-y-2">
              <label className="sr-only" htmlFor="email">
                {t(locale, "checkout.field.email")}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-required="true"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "email-error" : undefined}
                className={`${emailInputClass} ${errors.email ? "border-red-400 focus:border-red-500 focus:ring-red-200/60" : ""}`}
                value={fields.email}
                onChange={(event) => setFields((current) => ({ ...current, email: event.target.value }))}
                onBlur={() => setTouched((current) => ({ ...current, email: true }))}
                placeholder={t(locale, "checkout.field.email")}
              />
              {errors.email ? (
                <p id="email-error" className="text-caption text-red-700">
                  {errors.email}
                </p>
              ) : null}
            </div>
          ) : null}
          {reviewRequired ? (
            <button
              type="button"
              className={`${ctaClass} ${ctaEnabled}`}
              onClick={() => setReviewRequired(false)}
            >
              {t(locale, "shop.reviewUpdatedOrder")}
            </button>
          ) : (
            <button type="submit" className={`${ctaClass} ${ctaEnabled}`} disabled={submitLocked}>
              {submitting ? t(locale, "checkout.processing") : t(locale, "checkout.submit")}
            </button>
          )}
        </form>
      ) : null}
    </div>
  );
}
