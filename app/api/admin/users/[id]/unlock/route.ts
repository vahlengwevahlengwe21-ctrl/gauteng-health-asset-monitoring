import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import {
  clearLoginAccountRateLimit,
  isSameOriginRequest,
  requireUser,
} from '@/lib/auth';
import { getDbPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

type UserRow = { persal_number: string } & RowDataPacket;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const auth = await requireUser(request, 'super_administrator');
  if (auth.response) return auth.response;

  const { id } = await params;
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<UserRow[]>(
      'SELECT persal_number FROM app_users WHERE id = ? AND is_protected = FALSE FOR UPDATE',
      [id]
    );
    if (users.length === 0) {
      await connection.rollback();
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    await connection.execute(
      'UPDATE app_users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
      [id]
    );
    await clearLoginAccountRateLimit(connection, users[0].persal_number);
    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Failed to unlock user account:', error);
    return NextResponse.json(
      { error: 'Unable to unlock the user account.' },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}