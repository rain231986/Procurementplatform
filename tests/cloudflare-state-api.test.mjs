import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizeSnapshotChange,
  changedTopLevelKeys,
  constantTimeSecretMatches,
  createSessionCookie,
  maskAccountNumber,
  parseCookieHeader,
  sanitizeAppState,
  validateAppState,
} from "../worker/state-api.js";

function validState(overrides = {}) {
  return {
    version: 1,
    locations: [],
    users: [],
    products: [],
    inventory: [],
    demands: [],
    auditLogs: [],
    supplierBankAccounts: [],
    supplierBankAttachments: [],
    ...overrides,
  };
}

test("Cloudflare state sanitizer removes password hashes and private storage keys", () => {
  const result = sanitizeAppState(validState({
    users: [{ id: "u1", passwordHash: "do-not-store", password_hash: "do-not-store" }],
    supplierBankAttachments: [{ id: "a1", storageKey: "private/object" }],
    supplierBankAccounts: [{
      id: "b1",
      accountNumber: "1234567890",
      accountNumberMasked: "",
    }],
  }));

  assert.equal("passwordHash" in result.users[0], false);
  assert.equal("password_hash" in result.users[0], false);
  assert.equal(result.supplierBankAttachments[0].storageKey, "[PRIVATE_STORAGE_KEY]");
  assert.equal(result.supplierBankAccounts[0].accountNumber, "******7890");
});

test("Cloudflare state payload validates version, required arrays and size", () => {
  assert.equal(validateAppState(validState()).valid, true);
  assert.equal(validateAppState({ version: 2 }).code, "STATE_VERSION_UNSUPPORTED");
  assert.equal(validateAppState(validState({ products: null })).code, "STATE_INVALID");
  assert.equal(validateAppState(validState({ auditLogs: ["x".repeat(200)] }), 100).code, "STATE_TOO_LARGE");
});

test("Cloudflare snapshot authorization requires ADMIN for bootstrap and user changes", () => {
  const before = validState({ users: [{ id: "u1", isActive: true }] });
  const after = validState({ users: [{ id: "u1", isActive: false }] });

  assert.equal(authorizeSnapshotChange("STORE", null, before).code, "STATE_BOOTSTRAP_ADMIN_REQUIRED");
  assert.equal(authorizeSnapshotChange("ADMIN", null, before).allowed, true);
  assert.equal(authorizeSnapshotChange("STORE", before, after).code, "STATE_ADMIN_FIELD_FORBIDDEN");
  assert.equal(authorizeSnapshotChange("ADMIN", before, after).allowed, true);
});

test("Cloudflare snapshot authorization protects supplier bank data", () => {
  const before = validState();
  const after = validState({ supplierBankAccounts: [{ id: "bank-1" }] });

  assert.equal(authorizeSnapshotChange("WAREHOUSE", before, after).code, "STATE_PRIVATE_FIELD_FORBIDDEN");
  assert.equal(authorizeSnapshotChange("PURCHASING", before, after).allowed, true);
});

test("Cloudflare utility functions parse cookies and compare secrets safely", async () => {
  assert.deepEqual(parseCookieHeader("a=1; pharmaflow_session=abc%20123"), {
    a: "1",
    pharmaflow_session: "abc 123",
  });
  assert.match(createSessionCookie("abc"), /HttpOnly/);
  assert.equal(maskAccountNumber("12345678"), "****5678");
  assert.deepEqual(changedTopLevelKeys({ a: 1, b: 2 }, { a: 1, b: 3 }), ["b"]);
  assert.equal(await constantTimeSecretMatches("sample-password-123", "sample-password-123"), true);
  assert.equal(await constantTimeSecretMatches("sample-password-123", "different-password-456"), false);
});
