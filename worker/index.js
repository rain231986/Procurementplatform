import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  authorizeSnapshotChange,
  clearSessionCookie,
  constantTimeSecretMatches,
  createSessionCookie,
  jsonResponse,
  parseCookieHeader,
  publicSessionUser,
  sanitizeAppState,
  sha256Hex,
  validateAppState,
  validateRole,
} from "./state-api.js";

const STATE_KEY = "phase1";
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;

function nowIso() {
  return new Date().toISOString();
}

function expiresIso(seconds = SESSION_TTL_SECONDS) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw Object.assign(new Error("請使用 JSON 格式"), { status: 415, code: "CONTENT_TYPE_INVALID" });
  }
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("JSON 格式不正確"), { status: 400, code: "JSON_INVALID" });
  }
}

async function readStateRow(db) {
  return db
    .prepare("SELECT state_json, revision, updated_at, updated_by FROM app_state WHERE state_key = ?")
    .bind(STATE_KEY)
    .first();
}

function parseStoredState(row) {
  if (!row?.state_json) return null;
  try {
    return JSON.parse(row.state_json);
  } catch {
    return null;
  }
}

async function recordAudit(db, {
  action,
  entityType,
  entityId,
  userId = null,
  metadata = {},
  requestId = crypto.randomUUID(),
}) {
  await db
    .prepare(`
      INSERT INTO cloud_audit_logs (
        id, action, entity_type, entity_id, user_id, metadata_json, request_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      crypto.randomUUID(),
      action,
      entityType,
      entityId,
      userId,
      JSON.stringify(metadata),
      requestId,
      nowIso(),
    )
    .run();
}

async function loadLoginUser(db, username) {
  const stateRow = await readStateRow(db);
  if (stateRow?.state_json) {
    const state = parseStoredState(stateRow);
    const stateUser = (state?.users || []).find((candidate) => candidate.username === username);
    if (!stateUser || !validateRole(stateUser.role)) return null;
    return {
      id: stateUser.id,
      username: stateUser.username,
      display_name: stateUser.displayName,
      role: stateUser.role,
      location_id: stateUser.locationId || null,
      is_store_manager: stateUser.isStoreManager ? 1 : 0,
      is_active: stateUser.isActive === false ? 0 : 1,
    };
  }

  return db
    .prepare(`
      SELECT id, username, display_name, role, location_id, is_store_manager, is_active
      FROM app_users
      WHERE username = ?
    `)
    .bind(username)
    .first();
}

async function upsertLoginUser(db, user, timestamp) {
  await db
    .prepare(`
      INSERT INTO app_users (
        id, username, display_name, role, location_id, is_store_manager, is_active,
        last_login_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role,
        location_id = excluded.location_id,
        is_store_manager = excluded.is_store_manager,
        is_active = excluded.is_active,
        last_login_at = excluded.last_login_at,
        updated_at = excluded.updated_at
    `)
    .bind(
      user.id,
      user.username,
      user.display_name,
      user.role,
      user.location_id,
      Number(user.is_store_manager || 0),
      Number(user.is_active ?? 1),
      timestamp,
      timestamp,
      timestamp,
    )
    .run();
}

async function getLoginAttempt(db, username) {
  return db
    .prepare("SELECT failed_count, locked_until FROM login_attempts WHERE username = ?")
    .bind(username)
    .first();
}

async function recordLoginFailure(db, username, existingAttempt) {
  const timestamp = nowIso();
  const failedCount = Number(existingAttempt?.failed_count || 0) + 1;
  const lockedUntil = failedCount >= MAX_LOGIN_FAILURES
    ? new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000).toISOString()
    : null;
  await db
    .prepare(`
      INSERT INTO login_attempts (username, failed_count, locked_until, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        failed_count = excluded.failed_count,
        locked_until = excluded.locked_until,
        updated_at = excluded.updated_at
    `)
    .bind(username, failedCount, lockedUntil, timestamp)
    .run();
}

async function authenticateRequest(request, db) {
  const cookies = parseCookieHeader(request.headers.get("cookie") || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  return db
    .prepare(`
      SELECT
        u.id, u.username, u.display_name, u.role, u.location_id,
        u.is_store_manager, u.is_active, s.expires_at
      FROM app_sessions s
      JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1
    `)
    .bind(tokenHash, nowIso())
    .first();
}

async function handleLogin(request, env) {
  const configuredPassword = String(env.PHARMAFLOW_TEST_PASSWORD || "");
  if (configuredPassword.length < 12) {
    return jsonResponse({
      ok: false,
      code: "AUTH_NOT_CONFIGURED",
      message: "Cloudflare 測試密碼尚未完成安全設定",
    }, 503);
  }

  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || username.length > 80 || !password || password.length > 256) {
    return jsonResponse({ ok: false, code: "LOGIN_INVALID", message: "帳號或密碼錯誤" }, 401);
  }

  const attempt = await getLoginAttempt(env.DB, username);
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > Date.now()) {
    return jsonResponse({
      ok: false,
      code: "LOGIN_TEMPORARILY_LOCKED",
      message: "登入失敗次數過多，請稍後再試",
    }, 429);
  }

  const user = await loadLoginUser(env.DB, username);
  const passwordMatches = await constantTimeSecretMatches(password, configuredPassword);
  if (!user || Number(user.is_active) !== 1 || !passwordMatches) {
    await recordLoginFailure(env.DB, username, attempt);
    return jsonResponse({ ok: false, code: "LOGIN_INVALID", message: "帳號或密碼錯誤" }, 401);
  }

  const timestamp = nowIso();
  const rawToken = randomToken();
  const tokenHash = await sha256Hex(rawToken);
  await upsertLoginUser(env.DB, user, timestamp);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username),
    env.DB.prepare("DELETE FROM app_sessions WHERE expires_at <= ?").bind(timestamp),
    env.DB.prepare(`
      INSERT INTO app_sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(tokenHash, user.id, expiresIso(), timestamp, timestamp),
  ]);
  await recordAudit(env.DB, {
    action: "LOGIN",
    entityType: "SESSION",
    entityId: user.id,
    userId: user.id,
    metadata: { environment: env.APP_ENV || "preview" },
  });

  return jsonResponse(
    { ok: true, user: publicSessionUser(user) },
    200,
    { "Set-Cookie": createSessionCookie(rawToken, SESSION_TTL_SECONDS, new URL(request.url).protocol === "https:") },
  );
}

async function handleSession(request, env) {
  const user = await authenticateRequest(request, env.DB);
  if (!user) {
    return jsonResponse({ ok: false, authenticated: false }, 401);
  }
  return jsonResponse({ ok: true, authenticated: true, user: publicSessionUser(user) });
}

async function handleLogout(request, env) {
  const cookies = parseCookieHeader(request.headers.get("cookie") || "");
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    const tokenHash = await sha256Hex(token);
    const user = await authenticateRequest(request, env.DB);
    await env.DB.prepare("DELETE FROM app_sessions WHERE token_hash = ?").bind(tokenHash).run();
    if (user) {
      await recordAudit(env.DB, {
        action: "LOGOUT",
        entityType: "SESSION",
        entityId: user.id,
        userId: user.id,
      });
    }
  }
  return jsonResponse(
    { ok: true },
    200,
    { "Set-Cookie": clearSessionCookie(new URL(request.url).protocol === "https:") },
  );
}

async function handleGetState(request, env) {
  const user = await authenticateRequest(request, env.DB);
  if (!user) return jsonResponse({ ok: false, code: "AUTH_REQUIRED", message: "請先登入" }, 401);
  const row = await readStateRow(env.DB);
  if (!row) {
    return jsonResponse({
      ok: true,
      state: null,
      revision: 0,
      requiresBootstrap: true,
      canBootstrap: user.role === "ADMIN",
    });
  }
  const parsed = parseStoredState(row);
  if (!parsed) {
    return jsonResponse({ ok: false, code: "STATE_CORRUPTED", message: "共用資料格式損毀" }, 500);
  }
  return jsonResponse({
    ok: true,
    state: parsed,
    revision: Number(row.revision || 0),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  });
}

async function handlePutState(request, env) {
  const user = await authenticateRequest(request, env.DB);
  if (!user) return jsonResponse({ ok: false, code: "AUTH_REQUIRED", message: "請先登入" }, 401);

  const body = await readJson(request);
  const expectedRevision = Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return jsonResponse({ ok: false, code: "REVISION_INVALID", message: "共用資料版本不正確" }, 400);
  }

  const sanitizedState = sanitizeAppState(body.state);
  const validation = validateAppState(sanitizedState);
  if (!validation.valid) return jsonResponse({ ok: false, ...validation }, 400);

  const existingRow = await readStateRow(env.DB);
  const existingState = parseStoredState(existingRow);
  const authorization = authorizeSnapshotChange(user.role, existingState, sanitizedState);
  if (!authorization.allowed) return jsonResponse({ ok: false, ...authorization }, 403);

  const currentRevision = Number(existingRow?.revision || 0);
  if (currentRevision !== expectedRevision) {
    return jsonResponse({
      ok: false,
      code: "STATE_CONFLICT",
      message: "其他使用者已更新共用資料",
      currentRevision,
    }, 409);
  }

  const requestId = crypto.randomUUID();
  const timestamp = nowIso();
  const nextRevision = currentRevision + 1;
  const serializedState = JSON.stringify(sanitizedState);
  const metadata = JSON.stringify({
    revision: nextRevision,
    changedKeys: authorization.changedKeys,
    bytes: validation.bytes,
  });

  if (!existingRow) {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT OR IGNORE INTO app_state (
          state_key, state_json, revision, last_request_id, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(STATE_KEY, serializedState, nextRevision, requestId, user.id, timestamp),
      env.DB.prepare(`
        INSERT INTO cloud_audit_logs (
          id, action, entity_type, entity_id, user_id, metadata_json, request_id, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state WHERE state_key = ? AND last_request_id = ?
        )
      `).bind(
        crypto.randomUUID(),
        "SHARED_STATE_BOOTSTRAPPED",
        "APP_STATE",
        STATE_KEY,
        user.id,
        metadata,
        requestId,
        timestamp,
        STATE_KEY,
        requestId,
      ),
    ]);
    if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
      const latest = await readStateRow(env.DB);
      return jsonResponse({
        ok: false,
        code: "STATE_CONFLICT",
        message: "其他使用者已先完成共用資料初始化",
        currentRevision: Number(latest?.revision || 0),
      }, 409);
    }
  } else {
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE app_state
        SET state_json = ?, revision = ?, last_request_id = ?, updated_by = ?, updated_at = ?
        WHERE state_key = ? AND revision = ?
      `).bind(serializedState, nextRevision, requestId, user.id, timestamp, STATE_KEY, currentRevision),
      env.DB.prepare(`
        INSERT INTO cloud_audit_logs (
          id, action, entity_type, entity_id, user_id, metadata_json, request_id, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM app_state WHERE state_key = ? AND last_request_id = ?
        )
      `).bind(
        crypto.randomUUID(),
        "SHARED_STATE_UPDATED",
        "APP_STATE",
        STATE_KEY,
        user.id,
        metadata,
        requestId,
        timestamp,
        STATE_KEY,
        requestId,
      ),
    ]);
    if (Number(results?.[0]?.meta?.changes || 0) !== 1) {
      const latest = await readStateRow(env.DB);
      return jsonResponse({
        ok: false,
        code: "STATE_CONFLICT",
        message: "其他使用者已更新共用資料",
        currentRevision: Number(latest?.revision || 0),
      }, 409);
    }
  }

  return jsonResponse({
    ok: true,
    revision: nextRevision,
    updatedAt: timestamp,
    updatedBy: user.id,
  });
}

async function handleApi(request, env) {
  if (!env?.DB) {
    return jsonResponse({
      ok: false,
      code: "D1_BINDING_MISSING",
      message: "D1 共用資料庫尚未綁定",
    }, 503);
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return jsonResponse({ ok: true, storage: "d1", environment: env.APP_ENV || "preview" });
    } catch {
      return jsonResponse({ ok: false, code: "D1_UNAVAILABLE", message: "D1 共用資料庫目前無法使用" }, 503);
    }
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") return handleLogin(request, env);
  if (request.method === "GET" && url.pathname === "/api/auth/session") return handleSession(request, env);
  if (request.method === "POST" && url.pathname === "/api/auth/logout") return handleLogout(request, env);
  if (request.method === "GET" && url.pathname === "/api/state") return handleGetState(request, env);
  if (request.method === "PUT" && url.pathname === "/api/state") return handlePutState(request, env);
  return jsonResponse({ ok: false, code: "API_NOT_FOUND", message: "找不到指定的 API" }, 404);
}

async function fetchStaticAsset(request, env) {
  if (!env?.ASSETS) return new Response("ASSETS binding is not configured", { status: 500 });
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || request.method !== "GET") return response;

  const url = new URL(request.url);
  if (url.pathname === "/" || !url.pathname.includes(".")) {
    return env.ASSETS.fetch(new Request(new URL("/index.html", url), request));
  }
  return response;
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      return await fetchStaticAsset(request, env);
    } catch (error) {
      const status = Number(error?.status || 500);
      return jsonResponse({
        ok: false,
        code: error?.code || "INTERNAL_ERROR",
        message: status >= 500 ? "伺服器暫時無法處理要求" : String(error?.message || "要求失敗"),
      }, status);
    }
  },
};
