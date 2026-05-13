import { NextResponse } from "next/server";

export function GET(request: Request) {
  const loginUrl = new URL("/admin-login", request.url);
  const response = NextResponse.redirect(loginUrl);
  response.cookies.set("admin_auth", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
