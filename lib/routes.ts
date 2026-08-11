/**
 * Single source of truth for internal application paths and absolute URL building.
 * Prefer these helpers over string literals. Absolute app URLs must be built from
 * a runtime origin (browser, request, or deployment), never a hardcoded domain.
 */

export const routes = {
  admin: {
    index: () => "/admin",
    login: () => "/admin-login",
    orders: () => "/admin/orders",
    ordersNew: () => "/admin/orders/new",
    ordersWithQuery: (query: string) => {
      const qs = query.replace(/^\?/, "");
      return qs ? `/admin/orders?${qs}` : "/admin/orders";
    },
    posSpots: () => "/admin/pos-spots",
    posSpotsWithQuery: (query: string) => {
      const qs = query.replace(/^\?/, "");
      return qs ? `/admin/pos-spots?${qs}` : "/admin/pos-spots";
    },
    posSpotEdit: (posSpotId: string) =>
      `/admin/pos-spots/${encodeURIComponent(posSpotId.trim())}/edit`,
    qr: () => "/admin/qr",
    plants: () => "/admin/plants",
    offers: () => "/admin/offers",
    partners: () => "/admin/partners",
    cardcomTest: () => "/admin/cardcom-test",
    partner: (partnerId: string) =>
      `/admin/partners/${encodeURIComponent(partnerId.trim())}`,
    partnerPockets: (partnerId: string) =>
      `/admin/partners/${encodeURIComponent(partnerId.trim())}#pockets`,
    partnerPosSpots: (partnerId: string) =>
      `/admin/partners/${encodeURIComponent(partnerId.trim())}#pos-spots`,
  },
  pos: {
    spot: (spotSlug: string) => `/pos/${encodeURIComponent(spotSlug.trim())}`,
    checkout: (spotSlug: string) =>
      `/checkout/pos/${encodeURIComponent(spotSlug.trim())}`,
  },
  customer: {
    accessibility: () => "/accessibility",
    success: (params?: URLSearchParams | Record<string, string>) => {
      if (!params) return "/success";
      const qs =
        params instanceof URLSearchParams
          ? params.toString()
          : new URLSearchParams(params).toString();
      return qs ? `/success?${qs}` : "/success";
    },
    paymentSuccess: (params?: { orderId?: string; resume?: string }) => {
      const orderId = params?.orderId?.trim();
      if (!orderId) return "/payment/success";
      const qs = new URLSearchParams({ orderId });
      const resume = params?.resume?.trim();
      if (resume) qs.set("resume", resume);
      return `/payment/success?${qs.toString()}`;
    },
    /** Legacy stub — Cardcom FailedRedirectUrl now targets checkout. */
    paymentFailed: (params?: { orderId?: string }) => {
      const orderId = params?.orderId?.trim();
      if (!orderId) return "/payment/failed";
      return `/payment/failed?${new URLSearchParams({ orderId }).toString()}`;
    },
    /** Checkout return after Cardcom fail/cancel (same existing checkout page). */
    checkoutPaymentFailed: (input: {
      spotSlug: string;
      orderId: string;
      resumeToken: string;
    }) => {
      const spotSlug = encodeURIComponent(input.spotSlug.trim());
      const qs = new URLSearchParams({
        paymentFailed: "1",
        orderId: input.orderId.trim(),
        resume: input.resumeToken.trim(),
      });
      return `/checkout/pos/${spotSlug}?${qs.toString()}`;
    },
  },
  api: {
    adminLogin: () => "/api/admin-login",
    adminLogout: () => "/api/admin-logout",
    orders: () => "/api/orders",
    order: (orderId: string) => `/api/orders/${encodeURIComponent(orderId.trim())}`,
    posSpots: () => "/api/pos-spots",
    posSpot: (posSpotId: string) =>
      `/api/pos-spots/${encodeURIComponent(posSpotId.trim())}`,
    plants: () => "/api/plants",
    plant: (plantId: string) => `/api/plants/${encodeURIComponent(plantId.trim())}`,
    plantImages: () => "/api/plant-images",
    offers: () => "/api/offers",
    offer: (offerId: string) => `/api/offers/${encodeURIComponent(offerId.trim())}`,
    partners: () => "/api/partners",
    partner: (partnerId: string) =>
      `/api/partners/${encodeURIComponent(partnerId.trim())}`,
    partnerPockets: (partnerId: string) =>
      `/api/partners/${encodeURIComponent(partnerId.trim())}/pockets`,
    partnerPocket: (partnerId: string, pocketId: string) =>
      `/api/partners/${encodeURIComponent(partnerId.trim())}/pockets/${encodeURIComponent(pocketId.trim())}`,
    sendPurchaseEmail: () => "/api/send-purchase-email",
    cardcomCreate: () => "/api/payments/cardcom/create",
    /** Cardcom LowProfile webhook — POST JSON; verifies via GetLpResult. */
    cardcomWebhook: () => "/api/payments/cardcom/webhook",
    /** Read-only payment verification status for `/payment/success` polling. */
    cardcomStatus: (orderId?: string) => {
      const id = orderId?.trim();
      if (!id) return "/api/payments/cardcom/status";
      return `/api/payments/cardcom/status?${new URLSearchParams({ orderId: id }).toString()}`;
    },
    /** Resume holder: create a new Cardcom LowProfile for the same pending order. */
    cardcomRetry: () => "/api/payments/cardcom/retry",
    /** Admin-only controlled Cardcom test Create (terminal 1000). */
    adminCardcomTest: () => "/api/admin/cardcom-test",
  },
  plantLibrary: (filename: string) =>
    `/plant-library/${encodeURIComponent(filename.trim())}`,
} as const;

/** POS plant page path (QR target). */
export function posSpotPath(spotSlug: string): string {
  return routes.pos.spot(spotSlug);
}

/** POS checkout path. */
export function posSpotCheckoutPath(spotSlug: string): string {
  return routes.pos.checkout(spotSlug);
}

/**
 * Join a same-origin absolute base with an internal path.
 * `origin` must come from the browser, request, or deployment — never a hardcoded domain.
 */
export function absoluteAppUrl(origin: string, path: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

/** Current browser origin (`protocol//host`). Empty during SSR. */
export function getClientOrigin(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.protocol}//${window.location.host}`;
}

/** Origin from a Next.js / Fetch request URL. */
export function getRequestOrigin(requestUrl: string | URL): string {
  const url = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  return url.origin;
}

/**
 * Public HTTPS site origin for Cardcom callbacks (Success / Failed / WebHook).
 * Requires `APP_ORIGIN` (e.g. https://your-site.netlify.app). Never uses localhost
 * or request host — Cardcom must reach a public URL.
 */
export function getPublicAppOrigin(): string {
  const raw = process.env.APP_ORIGIN?.trim();
  if (!raw) {
    throw new Error(
      "APP_ORIGIN is not set. Add a public HTTPS origin (e.g. https://your-site.netlify.app) to .env.local and Netlify Environment Variables.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "APP_ORIGIN must be a valid absolute URL (e.g. https://your-site.netlify.app).",
    );
  }

  if (parsed.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use HTTPS.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    throw new Error("APP_ORIGIN must be a public HTTPS origin (not localhost).");
  }

  return parsed.origin;
}

/**
 * Absolute Cardcom callback URLs from a validated public origin.
 * Success includes orderId + resume (for cancel→checkout).
 * Failed returns to the same checkout with paymentFailed + resume.
 */
export function buildCardcomCallbackUrls(
  origin: string,
  input: { orderId: string; spotSlug: string; resumeToken: string },
): {
  successRedirectUrl: string;
  failedRedirectUrl: string;
  webHookUrl: string;
} {
  const orderId = input.orderId.trim();
  const spotSlug = input.spotSlug.trim();
  const resumeToken = input.resumeToken.trim();
  return {
    successRedirectUrl: absoluteAppUrl(
      origin,
      routes.customer.paymentSuccess({ orderId, resume: resumeToken }),
    ),
    failedRedirectUrl: absoluteAppUrl(
      origin,
      routes.customer.checkoutPaymentFailed({
        spotSlug,
        orderId,
        resumeToken,
      }),
    ),
    webHookUrl: absoluteAppUrl(origin, routes.api.cardcomWebhook()),
  };
}

export function isAdminPath(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? "";
  return path === "/admin" || path.startsWith("/admin/") || path === "/admin-login";
}

/** Customer-facing paths that may be used as safe recovery destinations. */
export function isSafeCustomerReturnPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? "").trim();
  if (!path || path === "/") return false;
  if (isAdminPath(path)) return false;
  if (path.startsWith("/api/")) return false;

  if (/^\/pos\/[^/]+$/.test(path)) return true;
  if (/^\/checkout\/pos\/[^/]+$/.test(path)) return true;
  if (path === "/success") return true;
  return false;
}
