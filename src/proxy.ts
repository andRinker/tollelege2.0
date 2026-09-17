import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// Pages anyone can open. This is only an optimistic redirect based on cookie presence;
// pages, layouts, and server actions verify the session with requireTeacher().
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/design"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic =
    pathname === "/" ||
    PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (isPublic || getSessionCookie(request)) return NextResponse.next();

  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|vendor|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm|txt|xml|webmanifest)$).*)",
  ],
};
