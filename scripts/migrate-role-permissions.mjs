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
  const [columns] = await connection.query("SHOW COLUMNS FROM app_users LIKE 'role'");
  if (columns.length === 0) {
    throw new Error('app_users.role was not found.');
  }
  const migration = [
    `ALTER TABLE app_users MODIFY role ENUM(
      'asset_manager',
      'disposal_officer',
      'disposal_approver',
      'administrator',
      'super_administrator',
      'system_administrator',
      'supervisor',
      'admin_clerk',
      'chief_director'
    ) NOT NULL`,
    `UPDATE app_users
      SET role = CASE role
        WHEN 'administrator' THEN 'super_administrator'
        WHEN 'disposal_officer' THEN 'admin_clerk'
        WHEN 'disposal_approver' THEN 'supervisor'
        ELSE role
      END
      WHERE role IN ('administrator', 'disposal_officer', 'disposal_approver')`,
    `ALTER TABLE app_users MODIFY role ENUM(
      'super_administrator',
      'system_administrator',
      'asset_manager',
      'supervisor',
      'admin_clerk',
      'chief_director'
    ) NOT NULL`,
  ];
  for (const statement of migration) {
    await connection.query(statement);
  }
  console.log('System Administrator role is ready; Super Administrator remains protected.');
} catch (error) {
  console.error(`Role permission migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await connection.end();
}
