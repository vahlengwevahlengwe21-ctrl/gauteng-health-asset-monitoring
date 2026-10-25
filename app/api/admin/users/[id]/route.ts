import { NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { isSameOriginRequest, requireUser } from '@/lib/auth';
import { getDbPool } from '@/lib/db';
import type { AppRole } from '@/lib/auth';
import { APP_ROLES } from '@/lib/roles';
import { GAUTENG_DISTRICTS } from '@/lib/types';
import { parseUserProfile } from '@/lib/user-validation';

export const dynamic = 'force-dynamic';

type UserRoleRow = {
  role: AppRole;
  is_active: number;
  is_protected: number;
  district: string | null;
} & RowDataPacket;
type RouteContext = { params: Promise<{ id: string }> };
type UserUpdateBody = Record<string, unknown>;

function isUserUpdateBody(value: unknown): value is UserUpdateBody {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
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
  const profileFields = [
    'display_name',
    'surname',
    'email',
    'contact_number',
  ] as const;
  if (!isUserUpdateBody(body)) {
    return NextResponse.json({ error: 'Provide a valid account update.' }, { status: 400 });
  }
  const update = body;
  const profileFieldCount = profileFields.filter((field) => field in update).length;
  const profile = profileFieldCount === profileFields.length ? parseUserProfile(update) : null;
  if (
    !('role' in update) ||
    !('is_active' in update) ||
    !('district' in update) ||
    typeof update.role !== 'string' ||
    typeof update.is_active !== 'boolean' ||
    (typeof update.district !== 'string' && update.district !== null) ||
    !APP_ROLES.includes(update.role as AppRole) ||
    (update.role === 'system_administrator'
      ? update.district !== null
      : typeof update.district !== 'string' ||
        !GAUTENG_DISTRICTS.includes(
          update.district as (typeof GAUTENG_DISTRICTS)[number]
        )) ||
    update.role === 'super_administrator' ||
    (profileFieldCount !== 0 &&
      (profileFieldCount !== profileFields.length || !profile))
  ) {
    return NextResponse.json({ error: 'Provide a valid role, active state, district, and complete profile details when editing a profile.' }, { status: 400 });
  }
  const nextRole = update.role as AppRole;
  const nextActive = update.is_active as boolean;
  const nextDistrict = update.district as string | null;
  if (id === auth.user.id && !nextActive) {
    return NextResponse.json({ error: 'You cannot deactivate your own account.' }, { status: 400 });
  }
  if (id === auth.user.id && nextRole !== auth.user.role) {
    return NextResponse.json({ error: 'You cannot change your own role.' }, { status: 400 });
  }

  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<UserRoleRow[]>(
      'SELECT role, is_active, is_protected, district FROM app_users WHERE id = ? FOR UPDATE',
      [id]
    );
    if (rows.length === 0) {
      await connection.rollback();
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }
    const current = rows[0];
    if (current.is_protected) {
      await connection.rollback();
      return NextResponse.json(
        { error: 'This protected Super Administrator account cannot be changed or deactivated.' },
        { status: 403 }
      );
    }
    if (current.role === 'super_administrator' && current.is_active && (!nextActive || nextRole !== 'super_administrator')) {
      const [admins] = await connection.query<(RowDataPacket & { count: number })[]>(
        `SELECT COUNT(*) AS count FROM app_users
        WHERE role = 'super_administrator' AND is_active = TRUE AND id <> ?`,
        [id]
      );
      if (Number(admins[0].count) === 0) {
        await connection.rollback();
        return NextResponse.json(
          { error: 'At least one active Super Administrator must remain.' },
          { status: 409 }
        );
      }
    }
    if (profile) {
      await connection.execute<ResultSetHeader>(
        `UPDATE app_users SET role = ?, is_active = ?, district = ?,
          display_name = ?, surname = ?, email = ?, contact_number = ?
        WHERE id = ?`,
        [
          nextRole,
          nextActive,
          nextDistrict,
          profile.display_name,
          profile.surname,
          profile.email,
          profile.contact_number,
          id,
        ]
      );
    } else {
      await connection.execute<ResultSetHeader>(
        'UPDATE app_users SET role = ?, is_active = ?, district = ? WHERE id = ?',
        [nextRole, nextActive, nextDistrict, id]
      );
    }
    if (
      !nextActive ||
      current.role !== nextRole ||
      current.district !== nextDistrict
    ) {
      await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [
        id,
      ]);
    }
    await connection.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    await connection.rollback();
    console.error('Failed to update authorized user:', error);
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      const message =
        (error as { message?: string }).message ?? '';
      return NextResponse.json(
        {
          error: message.includes('email')
            ? 'That work email address is already assigned to another account.'
            : 'That PERSAL number already has an account.',
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: 'Unable to update the account.' }, { status: 500 });
  } finally {
    connection.release();
  }
}
