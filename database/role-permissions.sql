-- Migrate the previous role names to the current operational role model.

ALTER TABLE app_users
  MODIFY role ENUM(
    'asset_manager',
    'disposal_officer',
    'disposal_approver',
    'administrator',
    'super_administrator',
    'system_administrator',
    'supervisor',
    'admin_clerk',
    'chief_director'
  ) NOT NULL;

UPDATE app_users
SET role = CASE role
  WHEN 'administrator' THEN 'super_administrator'
  WHEN 'disposal_officer' THEN 'admin_clerk'
  WHEN 'disposal_approver' THEN 'supervisor'
  ELSE role
END
WHERE role IN ('administrator', 'disposal_officer', 'disposal_approver');

ALTER TABLE app_users
  MODIFY role ENUM(
    'super_administrator',
    'system_administrator',
    'asset_manager',
    'supervisor',
    'admin_clerk',
    'chief_director'
  ) NOT NULL;
