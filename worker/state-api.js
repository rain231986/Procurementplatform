export const SESSION_COOKIE_NAME = "pharmaflow_session";
export const MAX_STATE_BYTES = 1_500_000;
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const REQUIRED_STATE_ARRAYS = ["locations", "users", "products", "inventory", "demands", "auditLogs"];
const VALID_ROLES = new Set(["ADMIN", "STORE", "WAREHOUSE", "PURCHASING"]);
const PRIVATE_STORAGE_PLACEHOLDER = "[PRIVATE_STORAGE_KEY]";

export function parseCookieHeader(headerValue = "") {
  return String(headerValue)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return cookies;
      const name = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
}

export function createSessionCookie(token, maxAgeSeconds = SESSION_TTL_SECONDS, secure = true) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`,
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie(secure = true) {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Strict",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function validateRole(role) {
  return VALID_ROLES.has(String(role || "").toUpperCase());
}

export function maskAccountNumber(value) {
  const normalized = String(value || "").replace(/\s+/g, "");
  if (!normalized) return "";
  if (normalized.includes("*")) return normalized;
  if (normalized.length <= 4) return "*".repeat(normalized.length);
  return `${"*".repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-4)}`;
}

export function sanitizeAppState(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const clone = typeof structuredClone === "function"
    ? structuredClone(input)
    : JSON.parse(JSON.stringify(input));

  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    delete value.passwordHash;
    delete value.password_hash;
    delete value.ADMIN_RESET_PASSWORD;

    if (Object.prototype.hasOwnProperty.call(value, "storageKey")) {
      value.storageKey = PRIVATE_STORAGE_PLACEHOLDER;
    }
    if (Object.prototype.hasOwnProperty.call(value, "storage_key")) {
      value.storage_key = PRIVATE_STORAGE_PLACEHOLDER;
    }

    Object.values(value).forEach(visit);
  };

  visit(clone);

  clone.supplierBankAccounts = (clone.supplierBankAccounts || []).map((account) => {
    const masked = account.accountNumberMasked || maskAccountNumber(account.accountNumber);
    return {
      ...account,
      accountNumber: masked,
      accountNumberMasked: masked,
    };
  });

  return clone;
}

export function validateAppState(input, maxBytes = MAX_STATE_BYTES) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, code: "STATE_INVALID", message: "共用資料格式不正確" };
  }
  if (Number(input.version) !== 1) {
    return { valid: false, code: "STATE_VERSION_UNSUPPORTED", message: "共用資料版本不受支援" };
  }

  const missingArray = REQUIRED_STATE_ARRAYS.find((key) => !Array.isArray(input[key]));
  if (missingArray) {
    return { valid: false, code: "STATE_INVALID", message: `共用資料缺少 ${missingArray}` };
  }

  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (bytes > maxBytes) {
    return { valid: false, code: "STATE_TOO_LARGE", message: "共用資料超過允許大小" };
  }

  return { valid: true, bytes };
}

export function changedTopLevelKeys(before, after) {
  const keys = new Set([
    ...Object.keys(before && typeof before === "object" ? before : {}),
    ...Object.keys(after && typeof after === "object" ? after : {}),
  ]);
  return [...keys].filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

export function authorizeSnapshotChange(role, before, after) {
  const normalizedRole = String(role || "").toUpperCase();
  if (!validateRole(normalizedRole)) {
    return { allowed: false, code: "ROLE_INVALID", message: "登入角色無效" };
  }
  if (!before) {
    return normalizedRole === "ADMIN"
      ? { allowed: true, changedKeys: Object.keys(after || {}) }
      : { allowed: false, code: "STATE_BOOTSTRAP_ADMIN_REQUIRED", message: "請先由系統管理者初始化共用資料" };
  }

  const changedKeys = changedTopLevelKeys(before, after);
  if (normalizedRole !== "ADMIN" && changedKeys.some((key) => key === "users" || key === "locations")) {
    return { allowed: false, code: "STATE_ADMIN_FIELD_FORBIDDEN", message: "只有系統管理者可修改使用者與據點資料" };
  }

  if (
    !["ADMIN", "PURCHASING"].includes(normalizedRole)
    && changedKeys.some((key) => key === "supplierBankAccounts" || key === "supplierBankAttachments")
  ) {
    return { allowed: false, code: "STATE_PRIVATE_FIELD_FORBIDDEN", message: "目前角色不可修改供應商銀行資料" };
  }

  return { allowed: true, changedKeys };
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function constantTimeSecretMatches(candidate, expected) {
  const [candidateHash, expectedHash] = await Promise.all([
    sha256Hex(candidate),
    sha256Hex(expected),
  ]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= candidateHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
}

export function publicSessionUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name ?? user.displayName,
    role: user.role,
    locationId: user.location_id ?? user.locationId ?? null,
    isStoreManager: Boolean(user.is_store_manager ?? user.isStoreManager),
    isActive: Boolean(user.is_active ?? user.isActive),
  };
}

export function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      ...extraHeaders,
    },
  });
}
