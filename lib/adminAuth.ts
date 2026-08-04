/** Shared admin session cookie (set by login API, checked by middleware). */
export const ADMIN_COOKIE = "admin_auth";
export const ADMIN_COOKIE_VALUE = "1";

/** True when the request carries a valid admin session cookie. */
export function isAdminRequest(request: {
  cookies: { get: (name: string) => { value: string } | undefined };
}): boolean {
  return request.cookies.get(ADMIN_COOKIE)?.value === ADMIN_COOKIE_VALUE;
}
