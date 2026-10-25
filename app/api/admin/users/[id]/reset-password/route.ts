import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import {
  clearLoginAccountRateLimit,
  hashPassword,
  isSameOriginRequest,
  requireUser,
} from '@/lib/auth';
import { getDbPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

type UserRow = {
  is_protected: number;
  persal_number: string;
} & RowDataPacket;
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const auth = await requireUser(request, 'super_administrator');
  if (auth.response) return auth.response;

  const { id } = await params;
  const temporaryPassword = randomBytes(24).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  const connection = await getDbPool().getConnection();

  try {
    await connection.beginTransaction();
    const [users] = await connection.execute<UserRow[]>(
      'SELECT is_protected, persal_number FROM app_users WHERE id = ? FOR UPDATE',
      [id]
    );
    if (users.length === 0) {
      await connection.rollback();
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    if (users[0].is_protected) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'The protected Super Administrator account cannot be reset here.' },
        { status: 403 }
      );
    }

    await connection.execute(
      `UPDATE app_users SET previous_password_hash =
          COALESCE(previous_password_hash, password_hash),
        password_hash = ?, temporary_password_expires_at =
          DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE),
        last_login_at = NULL,
        failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
      [passwordHash, id]
    );
    await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [id]);
    await clearLoginAccountRateLimit(connection, users[0].persal_number);
    await connection.commit();

    return NextResponse.json({ temporaryPassword });
  } catch (error) {
    await connection.rollback();
    console.error('Failed to reset user password:', error);
    return NextResponse.json(
      { error: 'Unable to reset the user password.' },
      { status: 500 }
    );
  } finally {
    connection.release();
  }
}
