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
    success: (params?: URLSearchParams | Record<string, string>) => {
      if (!params) return "/success";
      const qs =
        params instanceof URLSearchParams
          ? params.toString()
          : new URLSearchParams(params).toString();
      return qs ? `/success?${qs}` : "/success";
    },
    paymentSuccess: () => "/payment/success",
    paymentFailed: () => "/payment/failed",
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
