import { NextResponse } from 'next/server';
import {
  changePassword,
  isSameOriginRequest,
  requireUser,
  sessionCookie,
} from '@/lib/auth';
import {
  isStrongPassword,
  STRONG_PASSWORD_REQUIREMENTS,
} from '@/lib/password-policy.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const auth = await requireUser(request);
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('current_password' in body) ||
    !('new_password' in body) ||
    typeof body.current_password !== 'string' ||
    typeof body.new_password !== 'string' ||
    body.current_password.length === 0 ||
    !isStrongPassword(body.new_password)
  ) {
    return NextResponse.json(
      { error: `Enter your current password and a strong new password. ${STRONG_PASSWORD_REQUIREMENTS}` },
      { status: 400 }
    );
  }

  try {
    const token = await changePassword(
      auth.user.id,
      body.current_password,
      body.new_password
    );
    if (token === 'password_reused') {
      return NextResponse.json(
        { error: 'Choose a password different from your current and previous password.' },
        { status: 400 }
      );
    }
    if (!token) {
      return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
    }
    const response = NextResponse.json({ success: true });
    response.headers.set('Set-Cookie', sessionCookie(token));
    return response;
  } catch (error) {
    console.error('Failed to change password:', error);
    return NextResponse.json({ error: 'Unable to change the password.' }, { status: 500 });
  }
}
