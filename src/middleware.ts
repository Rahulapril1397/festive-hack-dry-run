import { NextResponse, type NextRequest } from "next/server";
import { GUEST_COOKIE, GUEST_COOKIE_MAX_AGE, isLinkKeyShape, signGuestCookie } from "@/domain/rsvp/guestCookie";

/**
 * Opening a family link (/f/:key) sets the signed family cookie used by /api/guest/*.
 * The key is only shape-checked here; the page itself shows "Link invalid or expired" for
 * unknown keys, and the API re-resolves the family on every call.
 */
export async function middleware(req: NextRequest) {
  const key = req.nextUrl.pathname.split("/")[2] ?? "";
  const res = NextResponse.next();
  const secret = process.env.GUEST_COOKIE_SECRET;
  if (secret && isLinkKeyShape(key)) {
    res.cookies.set(GUEST_COOKIE, await signGuestCookie(key, secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: req.nextUrl.protocol === "https:",
      path: "/",
      maxAge: GUEST_COOKIE_MAX_AGE,
    });
  }
  return res;
}

export const config = { matcher: ["/f/:key", "/f/:key/:path*"], runtime: "nodejs" };
