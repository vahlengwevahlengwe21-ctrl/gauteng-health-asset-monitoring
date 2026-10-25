import { NextResponse } from 'next/server';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  isSameOriginRequest,
  resetInactiveUserPassword,
  sessionCookie,
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
    !('current_password' in body) ||
    !('new_password' in body) ||
    typeof body.persal_number !== 'string' ||
    !/^\d{8}$/.test(body.persal_number) ||
    typeof body.current_password !== 'string' ||
    !body.current_password ||
    typeof body.new_password !== 'string' ||
    body.new_password.length < 12 ||
    body.new_password.length > 128
  ) {
    return NextResponse.json(
      { error: 'Enter your PERSAL number, current password, and a new password of 12–128 characters.' },
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
    const result = await resetInactiveUserPassword(
      body.persal_number,
      body.current_password,
      body.new_password
    );
    if (result === 'temporary_expired') {
      return NextResponse.json(
        { error: 'This temporary password has expired. Ask your administrator for a new one.' },
        { status: 410 }
      );
    }
    if (result === 'password_reused') {
      return NextResponse.json(
        { error: 'Choose a password different from your previous password.' },
        { status: 400 }
      );
    }
    if (result === 'not_required') {
      return NextResponse.json(
        { error: 'A password reset is not required for this account. Sign in again.' },
        { status: 409 }
      );
    }
    if (!result) {
      return NextResponse.json(
        { error: 'Login failed.' },
        { status: 401 }
      );
    }
    await clearLoginRateLimit(request, body.persal_number);
    const response = NextResponse.json({ success: true });
    response.headers.set('Set-Cookie', sessionCookie(result));
    return response;
  } catch (error) {
    console.error('Failed to reset inactive user password:', error);
    return NextResponse.json(
      { error: 'Password reset is temporarily unavailable.' },
      { status: 500 }
    );
  }
}
