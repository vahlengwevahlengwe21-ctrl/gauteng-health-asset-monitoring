import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session-constants';

export function middleware(request: NextRequest) {
  const applySecurityHeaders = (response: NextResponse) => {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set(
      'Permissions-Policy',
      'camera=(self), microphone=(), geolocation=()'
    );
    if (process.env.NODE_ENV === 'production') {
      response.headers.set(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains'
      );
      response.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
      );
    }
  };

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const response = NextResponse.next();
    response.headers.set('Cache-Control', 'no-store');
    applySecurityHeaders(response);
    return response;
  }

  if (request.nextUrl.pathname.startsWith('/ocr/')) {
    const response = NextResponse.next();
    applySecurityHeaders(response);
    return response;
  }

  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!hasSessionCookie && !isLoginPage) {
    const loginUrl = new URL('/login', request.url);
    const response = NextResponse.redirect(loginUrl);
    applySecurityHeaders(response);
    return response;
  }

  if (hasSessionCookie && isLoginPage) {
    const response = NextResponse.redirect(new URL('/', request.url));
    applySecurityHeaders(response);
    return response;
  }

  const response = NextResponse.next();
  applySecurityHeaders(response);
  return response;
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|health-logo.avif).*)'],
};
