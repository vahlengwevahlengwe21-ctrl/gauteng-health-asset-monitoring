import { NextResponse } from 'next/server';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  createSession,
  isSameOriginRequest,
  sessionCookie,
  verifyLoginCredentials,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('persal_number' in body) ||
    !('password' in body) ||
    typeof body.persal_number !== 'string' ||
    typeof body.password !== 'string' ||
    !/^\d{8}$/.test(body.persal_number) ||
    !body.password
  ) {
    return NextResponse.json(
      { error: 'Enter your 8-digit PERSAL number and password.' },
      { status: 400 }
    );
  }

  try {
    if (!(await checkLoginRateLimit(request, body.persal_number))) {
      return NextResponse.json(
        { error: 'Login failed.' },
        { status: 429, headers: { 'Retry-After': '900' } }
      );
    }
    const login = await verifyLoginCredentials(body.persal_number, body.password);
    if (!login) {
      return NextResponse.json(
        { error: 'Login failed.' },
        { status: 401 }
      );
    }
    await clearLoginRateLimit(request, body.persal_number);
    if (login.passwordResetRequired) {
      return NextResponse.json({
        passwordResetRequired: true,
        temporaryPasswordExpiresAt: login.temporaryPasswordExpiresAt,
      });
    }
    const token = await createSession(login.user.id);
    const response = NextResponse.json({ user: login.user });
    response.headers.set('Set-Cookie', sessionCookie(token));
    return response;
  } catch (error) {
    console.error('Failed to sign in:', error);
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 500 });
  }
}
