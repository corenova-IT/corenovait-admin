import mysql from "mysql2";

/**
 * SQL that creates the first admin when there's no SSH: import it once in
 * phpMyAdmin. It holds the argon2id HASH, never the password. It does
 * nothing if an active admin already exists, and says so in its result row.
 */
export function buildFirstAdminSql(input: { id: string; email: string; fullName: string; passwordHash: string; now: Date }): string {
  if (!/^\$argon2id\$/.test(input.passwordHash)) throw new Error("Expected an argon2id hash");
  const q = (v: string) => mysql.escape(v);
  const id = q(input.id);
  const ts = q(input.now.toISOString().replace("T", " ").replace("Z", ""));
  const exists = `EXISTS (SELECT 1 FROM \`users\` WHERE \`id\` = ${id})`;
  return `-- CoreNovaIT portal: create the first admin.
-- In phpMyAdmin, select the portal's database, then Import this file once.
-- It contains a password HASH only, never the password. Delete this file after importing.
-- If an active admin already exists it changes nothing and the result row says so.

START TRANSACTION;

INSERT INTO \`users\`
  (\`id\`, \`email\`, \`full_name\`, \`job_title\`, \`preset_id\`, \`status\`, \`password_hash\`, \`password_changed_at\`,
   \`mfa_required\`, \`failed_logins\`, \`created_at\`, \`updated_at\`)
SELECT ${id}, ${q(input.email)}, ${q(input.fullName)}, '', 'admin', 'active', ${q(input.passwordHash)}, ${ts},
   1, 0, ${ts}, ${ts}
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM \`users\` WHERE \`preset_id\` = 'admin' AND \`status\` = 'active');

INSERT INTO \`user_permissions\`
  (\`user_id\`, \`module\`, \`can_view\`, \`can_create\`, \`can_edit\`, \`can_delete\`, \`can_export\`, \`scope\`)
SELECT ${id}, \`module\`, \`can_view\`, \`can_create\`, \`can_edit\`, \`can_delete\`, \`can_export\`, \`scope\`
FROM \`preset_permissions\`
WHERE \`preset_id\` = 'admin' AND ${exists}
  AND NOT EXISTS (SELECT 1 FROM \`user_permissions\` WHERE \`user_id\` = ${id});

INSERT INTO \`audit_log\` (\`at\`, \`action\`, \`entity\`, \`entity_id\`, \`summary\`)
SELECT ${ts}, 'create', 'users', ${id}, ${q(`First admin ${input.email} created from an SQL import`)}
FROM DUAL
WHERE ${exists}
  AND NOT EXISTS (SELECT 1 FROM \`audit_log\` WHERE \`entity_id\` = ${id} AND \`action\` = 'create');

COMMIT;

SELECT IF(${exists}, 'First admin created. Sign in and set up two-factor.', 'NOT CREATED: an active admin already exists.') AS \`result\`;
`;
}
