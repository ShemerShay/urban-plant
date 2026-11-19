/** Staff-browser signal shared by PostHog and Neon analytics exclusion. */

export const INTERNAL_QUERY_PARAM = "up_internal";
export const INTERNAL_QUERY_VALUE = "1";
export const INTERNAL_COOKIE_NAME = "up_internal";
export const INTERNAL_STORAGE_KEY = "up_ph_internal";

export function isInternalAnalyticsSignal(input: {
  queryValue?: string | null;
  cookieValue?: string | null;
}): boolean {
  return (
    input.queryValue === INTERNAL_QUERY_VALUE || input.cookieValue === INTERNAL_QUERY_VALUE
  );
}

/** True when this browser was marked internal via the query param or cookie. */
export function browserIsInternal(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(INTERNAL_STORAGE_KEY) === INTERNAL_QUERY_VALUE) return true;
  } catch {
    // Private mode can block localStorage.
  }
  const needle = `${INTERNAL_COOKIE_NAME}=${INTERNAL_QUERY_VALUE}`;
  return document.cookie.split(";").some((part) => part.trim() === needle);
}
