import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import { isStrongPassword, STRONG_PASSWORD_REQUIREMENTS } from '../lib/password-policy.mjs';

const scrypt = promisify(scryptCallback);
const required = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'SUPER_ADMIN_PERSAL_NUMBER',
  'SUPER_ADMIN_NEW_PASSWORD',
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment settings: ${missing.join(', ')}`);
  process.exit(1);
}

const persalNumber = process.env.SUPER_ADMIN_PERSAL_NUMBER.trim();
const password = process.env.SUPER_ADMIN_NEW_PASSWORD;
if (!/^\d{8}$/.test(persalNumber) || password.length < 16 || !isStrongPassword(password)) {
  console.error(`Use an 8-digit PERSAL number and a unique strong password of 16–128 characters. ${STRONG_PASSWORD_REQUIREMENTS}`);
  process.exit(1);
}

const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  const [protectedUsers] = await connection.query(
    `SELECT id FROM app_users
    WHERE is_protected = TRUE AND role = 'super_administrator' AND is_active = TRUE`
  );
  if (protectedUsers.length !== 1) {
    throw new Error('Expected exactly one active protected Super Administrator.');
  }

  const [duplicate] = await connection.execute(
    'SELECT id FROM app_users WHERE persal_number = ? AND id <> ? LIMIT 1',
    [persalNumber, protectedUsers[0].id]
  );
  if (duplicate.length > 0) {
    throw new Error('That PERSAL number is already assigned to another account.');
  }

  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  const passwordHash = `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  await connection.beginTransaction();
  await connection.execute(
    `UPDATE app_users SET persal_number = ?,
      previous_password_hash = password_hash, password_hash = ?,
      temporary_password_expires_at = NULL, last_login_at = UTC_TIMESTAMP(),
      failed_login_attempts = 0, locked_until = NULL
    WHERE id = ?`,
    [persalNumber, passwordHash, protectedUsers[0].id]
  );
  await connection.execute('DELETE FROM app_sessions WHERE user_id = ?', [
    protectedUsers[0].id,
  ]);
  await connection.commit();
  console.log('Protected Super Administrator credentials rotated. Sign in with the configured PERSAL number and password.');
} catch (error) {
  await connection.rollback();
  console.error(`Super Administrator credential rotation failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
