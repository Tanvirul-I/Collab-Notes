import { NextRequest } from "next/server";
import { redirectToLogin, verifyRequestUser } from "./lib/auth";

const protectedPrefixes = ["/app"];

export async function middleware(request: NextRequest) {
  const isProtected = protectedPrefixes.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix)
  );

  if (!isProtected) {
    return;
  }

  const user = await verifyRequestUser(request);
  
  if (!user) {
    return redirectToLogin(request);
  }
}

export const config = {
  matcher: ["/app/:path*"]
};
