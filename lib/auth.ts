import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { RowDataPacket } from 'mysql2';
import { NextResponse } from 'next/server';
import { getDbPool } from './db';
import { APP_ROLES, type AppRole } from './roles';
import { SESSION_COOKIE } from './session-constants';
import { GAUTENG_DISTRICTS } from './types';

const scrypt = promisify(scryptCallback);
export const SESSION_DURATION_SECONDS = 60 * 60 * 12;

export type { AppRole } from './roles';

export type AuthenticatedUser = {
  id: string;
  display_name: string;
  surname: string | null;
  persal_number: string;
  email: string | null;
  contact_number: string | null;
  district: string | null;
  role: AppRole;
};

export function hasDistrictAssignment(user: AuthenticatedUser): boolean {
  return (
    user.role === 'super_administrator' ||
    GAUTENG_DISTRICTS.some((district) => district === user.district)
  );
}

export function canAccessDistrict(
  user: AuthenticatedUser,
  district: string
): boolean {
  return user.role === 'super_administrator' || user.district === district;
}

type SessionRow = AuthenticatedUser & {
  password_reset_required: number;
} & RowDataPacket;
type LoginRow = {
  id: string;
  display_name: string;
  surname: string | null;
  persal_number: string;
  email: string | null;
  contact_number: string | null;
  district: string | null;
  password_hash: string;
  role: AppRole;
  is_active: number;
  failed_login_attempts: number;
  locked_until: string | null;
  password_reset_required: number;
} & RowDataPacket;
type PasswordRow = { password_hash: string } & RowDataPacket;

function sessionTokenFromRequest(request: Request): string | null {
  const cookies = request.headers.get('cookie')?.split(';') ?? [];
  const cookie = cookies.find((part) =>
    part.trim().startsWith(`${SESSION_COOKIE}=`)
  );
  return cookie?.trim().slice(SESSION_COOKIE.length + 1) || null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function derivePassword(
  password: string,
  salt: Buffer
): Promise<Buffer> {
  return (await scrypt(password, salt, 64)) as Buffer;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const [, saltHex, hashHex] = encoded.split('$');
  if (
    !saltHex ||
    !hashHex ||
    !/^[a-f0-9]{32}$/i.test(saltHex) ||
    !/^[a-f0-9]{128}$/i.test(hashHex)
  ) {
    return false;
  }
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await derivePassword(password, Buffer.from(saltHex, 'hex'));
  return timingSafeEqual(expected, actual);
}

export async function authenticateRequest(
  request: Request
): Promise<AuthenticatedUser | null> {
  const token = sessionTokenFromRequest(request);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;

  const [rows] = await getDbPool().execute<SessionRow[]>(
    `SELECT u.id, u.display_name, u.surname, u.persal_number, u.email,
      u.contact_number, u.district, u.role,
      u.locked_until,
      CASE WHEN u.last_login_at IS NULL OR (
        u.role <> 'super_administrator' AND
        u.last_login_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
      ) THEN TRUE ELSE FALSE END AS password_reset_required
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()
      AND u.is_active = TRUE AND u.locked_until IS NULL`,
    [hashToken(token)]
  );
  const user = rows[0];
  if (!user) return null;
  if (user.password_reset_required) {
    await getDbPool().execute(
      'DELETE FROM app_sessions WHERE token_hash = ?',
      [hashToken(token)]
    );
    return null;
  }
  const { password_reset_required: _passwordResetRequired, ...authenticatedUser } = user;
  return authenticatedUser;
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await getDbPool().execute(
    `INSERT INTO app_sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
    [hashToken(token), userId, SESSION_DURATION_SECONDS]
  );
  return token;
}

export async function revokeSession(request: Request): Promise<void> {
  const token = sessionTokenFromRequest(request);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return;
  await getDbPool().execute('DELETE FROM app_sessions WHERE token_hash = ?', [
    hashToken(token),
  ]);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<string | null> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<PasswordRow[]>(
      'SELECT password_hash FROM app_users WHERE id = ? AND is_active = TRUE FOR UPDATE',
      [userId]
    );
    if (
      rows.length === 0 ||
      !(await verifyPassword(currentPassword, rows[0].password_hash))
    ) {
      await connection.rollback();
      return null;
    }
    const passwordHash = await hashPassword(newPassword);
    await connection.execute(
      `UPDATE app_users SET password_hash = ?, last_login_at = UTC_TIMESTAMP(),
        failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
      [passwordHash, userId]
    );
    await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [
      userId,
    ]);
    const token = randomBytes(32).toString('hex');
    await connection.execute(
      `INSERT INTO app_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
      [hashToken(token), userId, SESSION_DURATION_SECONDS]
    );
    await connection.commit();
    return token;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secure}`;
}

export function expiredSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function hasRole(
  user: AuthenticatedUser,
  ...roles: AppRole[]
): boolean {
  return user.role === 'super_administrator' || roles.includes(user.role);
}

export async function requireUser(
  request: Request,
  ...roles: AppRole[]
): Promise<
  | { user: AuthenticatedUser; response?: never }
  | { user?: never; response: NextResponse }
> {
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return {
        response: NextResponse.json(
          { error: 'Authentication required.' },
          { status: 401 }
        ),
      };
    }
    if (roles.length > 0 && !hasRole(user, ...roles)) {
      return {
        response: NextResponse.json(
          { error: 'You are not authorized to perform this action.' },
          { status: 403 }
        ),
      };
    }
    return { user };
  } catch (error) {
    console.error('Failed to authorize API request:', error);
    return {
      response: NextResponse.json(
        { error: 'Unable to verify authorization at this time.' },
        { status: 503 }
      ),
    };
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const origins = [new URL(request.url).origin];
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProtocol = request.headers.get('x-forwarded-proto');
    if (forwardedHost && forwardedProtocol) {
      const host = forwardedHost.split(',')[0].trim();
      const protocol = forwardedProtocol.split(',')[0].trim();
      if (host && (protocol === 'http' || protocol === 'https')) {
        origins.push(`${protocol}://${host}`);
      }
    }
    return origins.includes(new URL(origin).origin);
  } catch {
    return false;
  }
}

export async function verifyLoginCredentials(
  persalNumber: string,
  password: string
): Promise<{ user: AuthenticatedUser; passwordResetRequired: boolean } | null> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<LoginRow[]>(
      `SELECT id, display_name, surname, persal_number, email,
        contact_number, district, password_hash, role, is_active,
        failed_login_attempts, locked_until,
        CASE WHEN last_login_at IS NULL OR (
          role <> 'super_administrator' AND
          last_login_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
        ) THEN TRUE ELSE FALSE END AS password_reset_required
      FROM app_users WHERE persal_number = ? FOR UPDATE`,
      [persalNumber]
    );
    const user = rows[0];
    if (!user) {
      await derivePassword(password, Buffer.alloc(16, 0x51));
      await connection.commit();
      return null;
    }

    if (user.locked_until !== null) {
      await derivePassword(password, Buffer.alloc(16, 0x51));
      await connection.commit();
      return null;
    }

    const valid =
      user.is_active === 1 &&
      (await verifyPassword(password, user.password_hash));

    if (!valid) {
      await connection.execute(
        `UPDATE app_users SET
          locked_until = CASE
            WHEN failed_login_attempts >= 4 THEN COALESCE(locked_until, UTC_TIMESTAMP())
            ELSE locked_until
          END,
          failed_login_attempts = LEAST(failed_login_attempts + 1, 5)
        WHERE id = ?`,
        [user.id]
      );
      if (user.failed_login_attempts >= 4) {
        await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [
          user.id,
        ]);
      }
      await connection.commit();
      return null;
    }

    const passwordResetRequired = Boolean(user.password_reset_required);
    await connection.execute(
      `UPDATE app_users SET failed_login_attempts = 0, locked_until = NULL
      ${passwordResetRequired ? '' : ', last_login_at = UTC_TIMESTAMP()'}
      WHERE id = ?`,
      [user.id]
    );
    await connection.commit();
    return {
      passwordResetRequired,
      user: {
        id: user.id,
        display_name: user.display_name,
        surname: user.surname,
        persal_number: user.persal_number,
        email: user.email,
        contact_number: user.contact_number,
        district: user.district,
        role: user.role,
      },
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function resetInactiveUserPassword(
  persalNumber: string,
  currentPassword: string,
  newPassword: string
): Promise<string | 'not_required' | null> {
  const connection = await getDbPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<
      ({
        id: string;
        password_hash: string;
        is_active: number;
        role: AppRole;
        failed_login_attempts: number;
        locked_until: string | null;
        password_reset_required: number;
      } & RowDataPacket)[]
    >(
      `SELECT id, password_hash, is_active, role,
        failed_login_attempts, locked_until,
        CASE WHEN last_login_at IS NULL OR (
          role <> 'super_administrator' AND
          last_login_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
        ) THEN TRUE ELSE FALSE END AS password_reset_required
      FROM app_users WHERE persal_number = ? FOR UPDATE`,
      [persalNumber]
    );
    const user = rows[0];
    if (!user) {
      await derivePassword(currentPassword, Buffer.alloc(16, 0x51));
      await connection.commit();
      return null;
    }
    if (user.locked_until !== null) {
      await derivePassword(currentPassword, Buffer.alloc(16, 0x51));
      await connection.commit();
      return null;
    }
    if (
      user.is_active !== 1 ||
      !(await verifyPassword(currentPassword, user.password_hash))
    ) {
      await connection.execute(
        `UPDATE app_users SET
          locked_until = CASE
            WHEN failed_login_attempts >= 4 THEN COALESCE(locked_until, UTC_TIMESTAMP())
            ELSE locked_until
          END,
          failed_login_attempts = LEAST(failed_login_attempts + 1, 5)
        WHERE id = ?`,
        [user.id]
      );
      if (user.failed_login_attempts >= 4) {
        await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [
          user.id,
        ]);
      }
      await connection.commit();
      return null;
    }
    if (!user.password_reset_required) {
      await connection.rollback();
      return 'not_required';
    }
    if (await verifyPassword(newPassword, user.password_hash)) {
      await connection.rollback();
      return null;
    }
    const passwordHash = await hashPassword(newPassword);
    await connection.execute(
      `UPDATE app_users SET password_hash = ?, last_login_at = UTC_TIMESTAMP(),
        failed_login_attempts = 0, locked_until = NULL WHERE id = ?`,
      [passwordHash, user.id]
    );
    await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [
      user.id,
    ]);
    const token = randomBytes(32).toString('hex');
    await connection.execute(
      `INSERT INTO app_sessions (token_hash, user_id, expires_at)
      VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))`,
      [hashToken(token), user.id, SESSION_DURATION_SECONDS]
    );
    await connection.commit();
    return token;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const LOGIN_RATE_WINDOW_MINUTES = 15;
const LOGIN_RATE_LIMIT_PER_ACCOUNT = 10;
const LOGIN_RATE_LIMIT_PER_ADDRESS = 100;
let loginRateCleanupCounter = 0;

function loginRateLimitKeys(
  request: Request,
  persalNumber: string
): { key: string; limit: number }[] {
  const address =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '';
  return [
    ...(address
      ? [
          {
            key: createHash('sha256').update(`address:${address}`).digest('hex'),
            limit: LOGIN_RATE_LIMIT_PER_ADDRESS,
          },
        ]
      : []),
    {
      key: createHash('sha256').update(`persal:${persalNumber}`).digest('hex'),
      limit: LOGIN_RATE_LIMIT_PER_ACCOUNT,
    },
  ];
}

export async function checkLoginRateLimit(
  request: Request,
  persalNumber: string
): Promise<boolean> {
  const limits = loginRateLimitKeys(request, persalNumber);
  for (const { key } of limits) {
    await getDbPool().execute(
      `INSERT INTO app_login_rate_limits (key_hash, window_started_at, attempts)
      VALUES (?, UTC_TIMESTAMP(), 1)
      ON DUPLICATE KEY UPDATE
        attempts = IF(
          window_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE),
          1,
          attempts + 1
        ),
        window_started_at = IF(
          window_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE),
          UTC_TIMESTAMP(),
          window_started_at
        )`,
      [key, LOGIN_RATE_WINDOW_MINUTES, LOGIN_RATE_WINDOW_MINUTES]
    );
  }
  const keys = limits.map(({ key }) => key);
  const placeholders = keys.map(() => '?').join(', ');
  const [rows] = await getDbPool().execute<
    (RowDataPacket & { key_hash: string; attempts: number })[]
  >(
    `SELECT key_hash, attempts FROM app_login_rate_limits
    WHERE key_hash IN (${placeholders})`,
    keys
  );
  loginRateCleanupCounter += 1;
  if (loginRateCleanupCounter % 100 === 0) {
    await getDbPool().execute(
      `DELETE FROM app_login_rate_limits
      WHERE window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
      LIMIT 500`
    );
  }
  const attemptsByKey = new Map(
    rows.map((row) => [row.key_hash, Number(row.attempts)])
  );
  return limits.every(
    ({ key, limit }) => (attemptsByKey.get(key) ?? limit + 1) <= limit
  );
}

export async function clearLoginRateLimit(
  request: Request,
  persalNumber: string
): Promise<void> {
  const keys = loginRateLimitKeys(request, persalNumber).map(({ key }) => key);
  const placeholders = keys.map(() => '?').join(', ');
  await getDbPool().execute(
    `DELETE FROM app_login_rate_limits WHERE key_hash IN (${placeholders})`,
    keys
  );
}
