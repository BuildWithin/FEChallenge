import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic Auth gate for public demo deploys. A deployed URL spends real
 * OpenAI tokens on every chat turn, so we don't want it wide open.
 *
 * Credentials come from env vars and the gate is OPT-IN: if either is unset the
 * request passes straight through, so local dev, a zero-config clone, and tests
 * stay open. Set BOTH on Vercel to require a login. Because this runs in the
 * proxy (Next 16's renamed middleware), it also protects the API routes
 * (`/api/chat`, `/api/trpc`) — not just the pages — so the model endpoint can't
 * be hit directly to burn tokens.
 */
const USER = process.env.BASIC_AUTH_USER;
const PASSWORD = process.env.BASIC_AUTH_PASSWORD;

export function proxy(req: NextRequest) {
  // Gate disabled unless both credentials are configured.
  if (!USER || !PASSWORD) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice("Basic ".length));
      const sep = decoded.indexOf(":"); // password may itself contain ":"
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (user === USER && pass === PASSWORD) return NextResponse.next();
    } catch {
      // Malformed credentials — fall through to the 401 below.
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="ATS Copilot", charset="UTF-8"',
    },
  });
}

export const config = {
  // Protect everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
