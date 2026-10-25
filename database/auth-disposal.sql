-- Apply this migration once. It introduces authenticated users and sessions,
-- two-person disposal approval, and custody release while retaining asset history.

ALTER TABLE health_assets
  MODIFY custodian_name VARCHAR(255) NULL;

CREATE TABLE IF NOT EXISTS app_users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  display_name VARCHAR(150) NOT NULL,
  surname VARCHAR(100) NULL,
  persal_number VARCHAR(8) NOT NULL UNIQUE,
  district VARCHAR(32) NULL,
  email VARCHAR(254) NULL UNIQUE,
  contact_number VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  role ENUM(
    'super_administrator',
    'system_administrator',
    'asset_manager',
    'supervisor',
    'admin_clerk',
    'chief_director'
  ) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_app_sessions_user (user_id),
  INDEX idx_app_sessions_expiry (expires_at),
  CONSTRAINT fk_app_sessions_user
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_login_rate_limits (
  key_hash CHAR(64) NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_login_rate_limits_window (window_started_at)
);

CREATE TABLE IF NOT EXISTS health_asset_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asset_id CHAR(36) NOT NULL,
  asset_tag VARCHAR(191) NOT NULL,
  action ENUM('created', 'updated', 'deleted') NOT NULL,
  actor_id CHAR(36) NOT NULL,
  before_snapshot JSON NULL,
  after_snapshot JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_asset_audit_asset (asset_id, created_at),
  INDEX idx_asset_audit_created (created_at),
  CONSTRAINT fk_asset_audit_actor
    FOREIGN KEY (actor_id) REFERENCES app_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS health_asset_disposals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  asset_id CHAR(36) NOT NULL,
  former_custodian_name VARCHAR(255) NOT NULL,
  former_custodian_persal_number VARCHAR(8) NULL,
  disposal_method VARCHAR(100) NOT NULL,
  disposal_reason TEXT NOT NULL,
  disposal_date DATE NOT NULL,
  reference_number VARCHAR(191) NOT NULL,
  previous_status VARCHAR(50) NOT NULL,
  status ENUM('Pending', 'Approved', 'Rejected') NOT NULL DEFAULT 'Pending',
  requested_by CHAR(36) NOT NULL,
  requester_name_snapshot VARCHAR(255) NULL,
  requester_persal_number_snapshot VARCHAR(8) NULL,
  requester_role_snapshot VARCHAR(32) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  district_snapshot VARCHAR(32) NULL,
  sub_district_snapshot VARCHAR(150) NULL,
  facility_name_snapshot VARCHAR(255) NULL,
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  approver_notes TEXT NULL,
  reviewer_name_snapshot VARCHAR(255) NULL,
  reviewer_persal_number_snapshot VARCHAR(8) NULL,
  reviewer_role_snapshot VARCHAR(32) NULL,
  rejected_by CHAR(36) NULL,
  rejected_at DATETIME NULL,
  INDEX idx_asset_disposals_asset (asset_id, requested_at),
  INDEX idx_asset_disposals_status (status, requested_at),
  CONSTRAINT fk_asset_disposals_asset
    FOREIGN KEY (asset_id) REFERENCES health_assets(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_disposals_requester
    FOREIGN KEY (requested_by) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_disposals_approver
    FOREIGN KEY (approved_by) REFERENCES app_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_asset_disposals_rejecter
    FOREIGN KEY (rejected_by) REFERENCES app_users(id) ON DELETE RESTRICT
);
