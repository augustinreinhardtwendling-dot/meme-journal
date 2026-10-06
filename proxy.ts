import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Tout le site est privé : sans session valide, direction la page de connexion.
export function proxy(request: NextRequest) {
  const ok = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  }
  const url = request.nextUrl.clone();
  url.pathname = "/connexion";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!connexion|_next/static|_next/image|favicon.ico|icon|manifest.webmanifest).*)"],
};
