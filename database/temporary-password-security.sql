-- Add one-time temporary password expiration and previous-password tracking.

ALTER TABLE app_users
  ADD COLUMN previous_password_hash VARCHAR(255) NULL AFTER password_hash,
  ADD COLUMN temporary_password_expires_at DATETIME NULL AFTER last_login_at;

UPDATE app_users SET temporary_password_expires_at = UTC_TIMESTAMP()
WHERE last_login_at IS NULL AND temporary_password_expires_at IS NULL
  AND is_protected = FALSE AND role <> 'super_administrator';
