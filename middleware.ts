import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ADMIN_COOKIE, ADMIN_COOKIE_VALUE } from "@/lib/adminAuth";
import { getRequestOrigin, routes } from "@/lib/routes";

export function middleware(request: NextRequest) {
  const cookie = request.cookies.get(ADMIN_COOKIE);

  if (cookie?.value === ADMIN_COOKIE_VALUE) {
    return NextResponse.next();
  }

  const from = request.nextUrl.pathname + request.nextUrl.search;
  const loginUrl = new URL(routes.admin.login(), getRequestOrigin(request.url));
  loginUrl.searchParams.set("from", from);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
