import { NextRequest, NextResponse } from "next/server";

// Optional access gate for the /api/* proxy routes. When the server sets
// API_ACCESS_TOKEN, every /api request must carry a matching x-access-token
// header; otherwise it is rejected with 401. When the env var is unset the
// gate is fully open (unchanged default behavior for local use).
//
// Only reads a header, never the body — so streaming proxy responses and the
// routes' own request.json() are unaffected.
export function middleware(request: NextRequest) {
  const token = process.env.API_ACCESS_TOKEN;
  if (!token) return NextResponse.next();
  if (request.headers.get("x-access-token") !== token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
