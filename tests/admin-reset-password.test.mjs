import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  getAdminResetPassword,
  parseAdminResetArgs,
  resetAdminPassword,
} from "../scripts/admin-reset-password-core.mjs";
import { passwordPolicyError } from "../domain.js";

const PASSWORD_SUFFIX = randomBytes(18).toString("hex").replaceAll("123456", "abcdef");
const OLD_PASSWORD = `OldA${PASSWORD_SUFFIX}1`;
const NEW_PASSWORD = `FreshB${PASSWORD_SUFFIX}2`;

function fakeHash(password) {
  return `bcrypt-test:${password}`;
}

function createFakeDatabase(user, options = {}) {
  const state = {
    user: { ...user, passwordHash: fakeHash(OLD_PASSWORD), mustChangePassword: false, passwordChangedAt: null },
    audit: null,
    committed: false,
    rollbackCount: 0,
  };
  let snapshot = null;
  let inTransaction = false;

  return {
    state,
    async begin() {
      snapshot = { user: { ...state.user }, audit: state.audit, committed: state.committed };
      inTransaction = true;
    },
    async findUserForUpdate() {
      if (options.failOnSelect) throw new Error("database unavailable");
      return state.user;
    },
    async updatePassword({ passwordHash }) {
      state.user.passwordHash = passwordHash;
      state.user.passwordChangedAt = new Date();
      state.user.mustChangePassword = true;
      if (options.failOnUpdate) throw new Error("update failed");
      return true;
    },
    async insertAuditLog(record) {
      state.audit = structuredClone(record);
      if (options.failOnAudit) throw new Error("audit failed");
    },
    async commit() {
      inTransaction = false;
      state.committed = true;
    },
    async rollback() {
      if (!inTransaction) return;
      state.user = { ...snapshot.user };
      state.audit = snapshot.audit;
      state.committed = snapshot.committed;
      state.rollbackCount += 1;
      inTransaction = false;
    },
  };
}

async function reset(db, username = "admin", newPassword = NEW_PASSWORD) {
  return resetAdminPassword({ db, username, newPassword, hashPassword: fakeHash });
}

test("ADMIN 帳號可以成功重設密碼並要求下次登入改密碼", async () => {
  const db = createFakeDatabase({ id: "user_admin", username: "admin", role: "ADMIN", isActive: true });

  await reset(db);

  assert.equal(db.state.committed, true);
  assert.equal(db.state.user.passwordHash, fakeHash(NEW_PASSWORD));
  assert.equal(db.state.user.mustChangePassword, true);
  assert.ok(db.state.user.passwordChangedAt instanceof Date);
});

test("重設後舊密碼不能登入，新密碼可以登入", async () => {
  const db = createFakeDatabase({ id: "user_admin", username: "admin", role: "ADMIN", isActive: true });
  await reset(db);

  assert.notEqual(db.state.user.passwordHash, fakeHash(OLD_PASSWORD));
  assert.equal(db.state.user.passwordHash, fakeHash(NEW_PASSWORD));
});

test("非 ADMIN 帳號不能使用密碼重設", async () => {
  const db = createFakeDatabase({ id: "user_store", username: "store01", role: "STORE", isActive: true });

  await assert.rejects(reset(db, "store01"), (error) => error.code === "not_admin");
  assert.equal(db.state.user.passwordHash, fakeHash(OLD_PASSWORD));
  assert.equal(db.state.rollbackCount, 1);
});

test("停用 ADMIN 帳號不能重設", async () => {
  const db = createFakeDatabase({ id: "user_admin", username: "admin", role: "ADMIN", isActive: false });

  await assert.rejects(reset(db), (error) => error.code === "inactive_user");
  assert.equal(db.state.user.passwordHash, fakeHash(OLD_PASSWORD));
});

test("未設定 ADMIN_RESET_PASSWORD 時拒絕執行", () => {
  assert.throws(() => getAdminResetPassword({}), (error) => error.code === "password_required");
  assert.throws(() => getAdminResetPassword({ ADMIN_RESET_PASSWORD: "" }), (error) => error.code === "password_required");
});

test("弱密碼不會執行更新", async () => {
  const db = createFakeDatabase({ id: "user_admin", username: "admin", role: "ADMIN", isActive: true });

  await assert.rejects(reset(db, "admin", "password1234"), (error) => error.code === "weak_password");
  assert.equal(db.state.user.passwordHash, fakeHash(OLD_PASSWORD));
  assert.equal(db.state.committed, false);
});

test("audit log 不包含明碼或 password_hash", async () => {
  const db = createFakeDatabase({ id: "user_admin", username: "admin", role: "ADMIN", isActive: true });
  await reset(db);

  assert.equal(db.state.audit.action, "ADMIN_PASSWORD_RESET");
  assert.equal(db.state.audit.entityType, "USER");
  assert.equal(db.state.audit.entityId, "user_admin");
  const metadata = JSON.stringify(db.state.audit.metadata);
  assert.equal(metadata.includes(NEW_PASSWORD), false);
  assert.equal(metadata.includes(fakeHash(NEW_PASSWORD)), false);
  assert.equal(metadata.includes("password_hash"), false);
  assert.equal(metadata.includes("ADMIN_RESET_PASSWORD"), false);
});

test("資料庫更新失敗時原密碼保持有效", async () => {
  const db = createFakeDatabase(
    { id: "user_admin", username: "admin", role: "ADMIN", isActive: true },
    { failOnUpdate: true },
  );

  await assert.rejects(reset(db), (error) => error.code === "database_failure");
  assert.equal(db.state.user.passwordHash, fakeHash(OLD_PASSWORD));
  assert.equal(db.state.user.mustChangePassword, false);
  assert.equal(db.state.rollbackCount, 1);
});

test("audit 寫入失敗時原密碼保持有效", async () => {
  const db = createFakeDatabase(
    { id: "user_admin", username: "admin", role: "ADMIN", isActive: true },
    { failOnAudit: true },
  );

  await assert.rejects(reset(db), (error) => error.code === "database_failure");
  assert.equal(db.state.user.passwordHash, fakeHash(OLD_PASSWORD));
  assert.equal(db.state.user.mustChangePassword, false);
  assert.equal(db.state.rollbackCount, 1);
});

test("帳號不存在時拒絕執行", async () => {
  const db = createFakeDatabase(null);
  db.findUserForUpdate = async () => null;

  await assert.rejects(reset(db, "missing"), (error) => error.code === "user_not_found");
  assert.equal(db.state.rollbackCount, 1);
});

test("未提供 username 時拒絕解析指令", () => {
  assert.throws(() => parseAdminResetArgs([]), (error) => error.code === "username_required");
  assert.throws(() => parseAdminResetArgs(["--username"]), (error) => error.code === "username_required");
  assert.throws(() => parseAdminResetArgs(["--username", "admin", "--password", "<redacted>"]), (error) => error.code === "invalid_argument");
});

test("密碼政策涵蓋字母、數字、username 與常見弱密碼", () => {
  assert.match(passwordPolicyError("admin", "short1"), /12/);
  assert.match(passwordPolicyError("admin", "onlyletters!!"), /數字/);
  assert.match(passwordPolicyError("admin", "123456789012"), /英文字母/);
  assert.match(passwordPolicyError("admin", "Admin"), /12/);
  assert.match(passwordPolicyError("admin", "adminadmin12"), /弱密碼/);
  assert.equal(passwordPolicyError("admin", NEW_PASSWORD), null);
});
