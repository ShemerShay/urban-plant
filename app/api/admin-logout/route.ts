import { NextRequest, NextResponse } from "next/server";

import { ADMIN_COOKIE } from "@/lib/adminAuth";
import { getRequestOrigin, routes } from "@/lib/routes";

export async function GET(request: NextRequest) {
  const loginUrl = new URL(routes.admin.login(), getRequestOrigin(request.url));
  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
