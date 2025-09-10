import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
    // Try to extract the token (user session) from cookies
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    console.log(token);
  
    // If no token exists → user is not signed in → redirect
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  
    // Otherwise, let them through
    return NextResponse.next();
  }

export const config = {
  matcher: ["/dashboard/:path*"],
};