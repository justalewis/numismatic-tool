import { NextRequest, NextResponse } from "next/server";

// Simple HTTP Basic Auth gate for the whole app (page + /api/grade).
//
// Enabled only when BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set. On Fly they
// come from `fly secrets set`; locally they can go in .env.local (omit them to
// run ungated during development). The browser shows a native login prompt and
// caches the credentials for the session, so the page's fetch to /api/grade is
// authenticated automatically.

export const config = {
  // Run on everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

function unauthorized() {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Numismatic Tool"' },
  });
}

// Length-safe constant-ish comparison to avoid trivial timing leaks.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  // Not configured → no gate (e.g. local dev without the vars).
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      const u = decoded.slice(0, sep);
      const p = decoded.slice(sep + 1);
      if (safeEqual(u, user) && safeEqual(p, pass)) {
        return NextResponse.next();
      }
    } catch {
      // fall through to 401
    }
  }
  return unauthorized();
}
