import mysql from 'mysql2/promise';

const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing database settings: ${missing.join(', ')}`);
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
  const [previousPasswordColumn] = await connection.query(
    "SHOW COLUMNS FROM app_users LIKE 'previous_password_hash'"
  );
  if (previousPasswordColumn.length === 0) {
    await connection.query(
      'ALTER TABLE app_users ADD COLUMN previous_password_hash VARCHAR(255) NULL AFTER password_hash'
    );
  }

  const [expiryColumn] = await connection.query(
    "SHOW COLUMNS FROM app_users LIKE 'temporary_password_expires_at'"
  );
  if (expiryColumn.length === 0) {
    await connection.query(
      'ALTER TABLE app_users ADD COLUMN temporary_password_expires_at DATETIME NULL AFTER last_login_at'
    );
  }

  await connection.query(
    `UPDATE app_users SET temporary_password_expires_at = UTC_TIMESTAMP()
    WHERE last_login_at IS NULL AND temporary_password_expires_at IS NULL
      AND is_protected = FALSE AND role <> 'super_administrator'`
  );

  console.log('Temporary password expiry and password history schema is ready.');
} catch (error) {
  console.error(`Temporary password security migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
