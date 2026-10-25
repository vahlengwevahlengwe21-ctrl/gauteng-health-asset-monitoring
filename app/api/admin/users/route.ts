import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { hashPassword, isSameOriginRequest, requireUser } from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import type { AppRole } from '@/lib/auth';
import { APP_ROLES } from '@/lib/roles';
import { GAUTENG_DISTRICTS } from '@/lib/types';
import { parseUserProfile } from '@/lib/user-validation';

export const dynamic = 'force-dynamic';

type UserRow = {
  id: string;
  display_name: string;
  surname: string | null;
  persal_number: string;
  email: string | null;
  contact_number: string | null;
  district: string | null;
  role: AppRole;
  is_active: number;
  is_protected: number;
  failed_login_attempts: number;
  is_locked: number;
  created_at: string;
} & RowDataPacket;

export async function GET(request: Request) {
  const auth = await requireUser(request, 'super_administrator');
  if (auth.response) return auth.response;
  try {
    const [users] = await getDbPool().query<UserRow[]>(
      `SELECT id, display_name, surname, persal_number, email,
        contact_number, district,
        role, is_active, is_protected, failed_login_attempts,
        (locked_until IS NOT NULL) AS is_locked, created_at
      FROM app_users
      WHERE is_protected = FALSE AND role <> 'super_administrator'
      ORDER BY display_name`
    );
    return NextResponse.json(users);
  } catch (error) {
    console.error('Failed to list authorized users:', error);
    return NextResponse.json({ error: 'Unable to load authorized users.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const auth = await requireUser(request, 'super_administrator');
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
    !('persal_number' in body) ||
    !('password' in body) ||
    !('role' in body) ||
    !('district' in body) ||
    typeof body.persal_number !== 'string' ||
    typeof body.password !== 'string' ||
    typeof body.role !== 'string' ||
    (typeof body.district !== 'string' && body.district !== null) ||
    !/^\d{8}$/.test(body.persal_number) ||
    body.password.length < 12 ||
    body.password.length > 128 ||
    !APP_ROLES.includes(body.role as AppRole) ||
    (body.role === 'system_administrator'
      ? body.district !== null
      : typeof body.district !== 'string' ||
        !GAUTENG_DISTRICTS.includes(
          body.district as (typeof GAUTENG_DISTRICTS)[number]
        )) ||
    body.role === 'super_administrator'
  ) {
    return NextResponse.json(
      { error: 'Complete every required field with a valid name, surname, district when required, 8-digit PERSAL number, password, and role. Super Administrator accounts cannot be created here.' },
      { status: 400 }
    );
  }
  const profile = parseUserProfile(body);
  if (!profile) {
    return NextResponse.json(
      { error: 'Enter a valid first name, surname, work email address, and contact number.' },
      { status: 400 }
    );
  }
  try {
    await getDbPool().execute(
      `INSERT INTO app_users (
        id, display_name, surname, persal_number, district, email,
        contact_number, password_hash, role, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      [
        randomUUID(),
        profile.display_name,
        profile.surname,
        body.persal_number,
        body.district,
        profile.email,
        profile.contact_number,
        await hashPassword(body.password),
        body.role,
      ]
    );
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('Failed to create authorized user:', error);
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      const message = (error as { message?: string }).message ?? '';
      return NextResponse.json(
        {
          error: message.includes('email')
            ? 'That work email address is already assigned to another account.'
            : 'That PERSAL number already has an account.',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Unable to create the account.' }, { status: 500 });
  }
}
