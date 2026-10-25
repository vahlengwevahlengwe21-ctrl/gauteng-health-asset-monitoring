import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
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
  'BOOTSTRAP_ADMIN_NAME',
  'BOOTSTRAP_ADMIN_PERSAL_NUMBER',
  'BOOTSTRAP_ADMIN_PASSWORD',
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment settings: ${missing.join(', ')}`);
  process.exit(1);
}

const displayName = process.env.BOOTSTRAP_ADMIN_NAME.trim();
const persalNumber = process.env.BOOTSTRAP_ADMIN_PERSAL_NUMBER.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (
  displayName.length < 2 ||
  displayName.length > 150 ||
  !/^\d{8}$/.test(persalNumber) ||
  !isStrongPassword(password)
) {
  console.error(`Admin name, 8-digit PERSAL number, or password does not meet validation requirements. ${STRONG_PASSWORD_REQUIREMENTS}`);
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
  const [admins] = await connection.query(
    `SELECT COUNT(*) AS count FROM app_users
    WHERE role = 'super_administrator' AND is_active = TRUE`
  );
  if (Number(admins[0].count) > 0) {
    throw new Error('An active Super Administrator already exists. Add further accounts in User management.');
  }

  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  const passwordHash = `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  await connection.execute(
    `INSERT INTO app_users (
      id, display_name, persal_number, email, password_hash, is_protected,
      role, last_login_at
    ) VALUES (?, ?, ?, NULL, ?, TRUE, 'super_administrator', UTC_TIMESTAMP())`,
    [randomUUID(), displayName, persalNumber, passwordHash]
  );
  console.log('Initial Super Administrator created. Sign in and remove the bootstrap values from .env.local.');
} catch (error) {
  console.error(`Unable to create the initial Super Administrator: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
