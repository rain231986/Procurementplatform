#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ADMIN_PASSWORD_BCRYPT_COST,
  getAdminResetPassword,
  getDatabaseUrl,
  parseAdminResetArgs,
  resetAdminPassword,
  safeResetErrorMessage,
} from "./admin-reset-password-core.mjs";

function createPostgresDatabase(client) {
  return {
    begin: () => client.query("BEGIN"),
    findUserForUpdate: async (username) => {
      const result = await client.query(
        `SELECT id, username, role, is_active AS "isActive"
           FROM users
          WHERE username = $1
          FOR UPDATE`,
        [username],
      );
      return result.rows[0] || null;
    },
    updatePassword: async ({ userId, passwordHash }) => {
      const result = await client.query(
        `UPDATE users
            SET password_hash = $1,
                password_changed_at = CURRENT_TIMESTAMP,
                must_change_password = TRUE,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $2`,
        [passwordHash, userId],
      );
      return result.rowCount === 1;
    },
    insertAuditLog: ({ userId, action, entityType, entityId, metadata }) => client.query(
      `INSERT INTO audit_logs
        (user_id, action, entity_type, entity_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)`,
      [userId, action, entityType, entityId, JSON.stringify(metadata)],
    ),
    commit: () => client.query("COMMIT"),
    rollback: () => client.query("ROLLBACK"),
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let client;
  try {
    const { username } = parseAdminResetArgs(argv);
    const newPassword = getAdminResetPassword(env);
    const databaseUrl = getDatabaseUrl(env);
    const [{ default: pg }, { default: bcrypt }] = await Promise.all([
      import("pg"),
      import("bcryptjs"),
    ]);

    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await resetAdminPassword({
      db: createPostgresDatabase(client),
      username,
      newPassword,
      hashPassword: (password) => bcrypt.hash(password, ADMIN_PASSWORD_BCRYPT_COST),
    });
    process.stdout.write("管理員密碼已完成重設\n");
  } catch (error) {
    process.stderr.write(`${safeResetErrorMessage(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

const currentFile = resolve(fileURLToPath(import.meta.url));
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (currentFile === invokedFile) {
  await main();
}
