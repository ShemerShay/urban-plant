import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "admin_auth";
export const ADMIN_COOKIE_VALUE = "1";

export function middleware(request: NextRequest) {
  const cookie = request.cookies.get(ADMIN_COOKIE);

  if (cookie?.value === ADMIN_COOKIE_VALUE) {
    return NextResponse.next();
  }

  const from = request.nextUrl.pathname + request.nextUrl.search;
  const loginUrl = new URL("/admin-login", request.url);
  loginUrl.searchParams.set("from", from);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
