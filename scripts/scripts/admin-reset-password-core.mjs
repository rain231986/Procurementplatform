import { passwordPolicyError } from "../domain.js";

export const ADMIN_PASSWORD_BCRYPT_COST = 12;
export const ADMIN_PASSWORD_RESET_ACTION = "ADMIN_PASSWORD_RESET";

export class AdminPasswordResetError extends Error {
  constructor(code, publicMessage) {
    super(publicMessage);
    this.name = "AdminPasswordResetError";
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function parseAdminResetArgs(argv = []) {
  let username = "";

  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index] || "");
    if (argument === "--username") {
      const value = String(argv[index + 1] || "").trim();
      if (!value || value.startsWith("--")) {
        throw new AdminPasswordResetError("username_required", "未提供 username");
      }
      username = value;
      index += 1;
    } else if (argument.startsWith("--username=")) {
      username = argument.slice("--username=".length).trim();
      if (!username) throw new AdminPasswordResetError("username_required", "未提供 username");
    } else {
      throw new AdminPasswordResetError("invalid_argument", "指令參數不符合要求");
    }
  }

  if (!username) throw new AdminPasswordResetError("username_required", "未提供 username");
  return { username };
}

export function getAdminResetPassword(env = process.env) {
  const password = env?.ADMIN_RESET_PASSWORD;
  if (typeof password !== "string" || password.length === 0) {
    throw new AdminPasswordResetError("password_required", "未設定 ADMIN_RESET_PASSWORD");
  }
  return password;
}

export function getDatabaseUrl(env = process.env) {
  const databaseUrl = env?.DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new AdminPasswordResetError("database_url_required", "未設定 DATABASE_URL");
  }
  return databaseUrl;
}

export function assertPasswordPolicy(username, password) {
  const errorMessage = passwordPolicyError(username, password);
  if (errorMessage) throw new AdminPasswordResetError("weak_password", errorMessage);
}

export function safeResetErrorMessage(error) {
  return error instanceof AdminPasswordResetError
    ? error.publicMessage
    : "管理員密碼重設失敗";
}

export async function resetAdminPassword({ db, username, newPassword, hashPassword }) {
  if (!db || typeof db.begin !== "function" || typeof db.commit !== "function" || typeof db.rollback !== "function") {
    throw new AdminPasswordResetError("database_failure", "管理員密碼重設失敗");
  }
  if (typeof hashPassword !== "function") {
    throw new AdminPasswordResetError("hash_failure", "管理員密碼重設失敗");
  }

  await db.begin();
  let transactionClosed = false;
  try {
    const user = await db.findUserForUpdate(username);
    if (!user) throw new AdminPasswordResetError("user_not_found", "帳號不存在");
    if (user.role !== "ADMIN") throw new AdminPasswordResetError("not_admin", "帳號不是 ADMIN");
    if (user.isActive !== true) throw new AdminPasswordResetError("inactive_user", "帳號已停用");

    assertPasswordPolicy(user.username || username, newPassword);
    const passwordHash = await hashPassword(newPassword);
    if (typeof passwordHash !== "string" || passwordHash.length === 0) {
      throw new AdminPasswordResetError("hash_failure", "管理員密碼重設失敗");
    }

    const updated = await db.updatePassword({ userId: user.id, passwordHash });
    if (updated === false) throw new AdminPasswordResetError("database_failure", "管理員密碼重設失敗");

    await db.insertAuditLog({
      userId: user.id,
      action: ADMIN_PASSWORD_RESET_ACTION,
      entityType: "USER",
      entityId: user.id,
      metadata: {
        source: "admin:reset-password",
        username: user.username || username,
        must_change_password: true,
      },
    });
    await db.commit();
    transactionClosed = true;
    return { userId: user.id, username: user.username || username };
  } catch (error) {
    if (!transactionClosed) {
      try {
        await db.rollback();
      } catch {
        // Preserve the original safe error and never expose database details.
      }
    }
    if (error instanceof AdminPasswordResetError) throw error;
    throw new AdminPasswordResetError("database_failure", "管理員密碼重設失敗");
  }
}
