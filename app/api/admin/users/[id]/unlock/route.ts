import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { isSameOriginRequest, requireUser } from '@/lib/auth';
import { getDbPool } from '@/lib/db';

export const dynamic = 'force-dynamic';

type UserRow = RowDataPacket;
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
      'SELECT id FROM app_users WHERE id = ? FOR UPDATE',
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
