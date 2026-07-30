const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "PharmaFlow",
};

export class CloudApiError extends Error {
  constructor(message, { status = 0, code = "API_ERROR", details = null } = {}) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isLocalDevelopmentHost(hostname = window.location.hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(String(hostname || "").toLowerCase());
}

async function readApiResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new CloudApiError(
      payload?.message || "雲端服務暫時無法使用",
      {
        status: response.status,
        code: payload?.code || "API_ERROR",
        details: payload,
      },
    );
  }
  return payload;
}

async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      ...options,
      headers: {
        ...(options.body ? API_HEADERS : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new CloudApiError("無法連線至 Cloudflare 共用服務", {
      code: "NETWORK_ERROR",
    });
  }
  return readApiResponse(response);
}

export async function detectCloudBackend() {
  try {
    const result = await apiFetch("/api/health");
    return {
      available: result?.ok === true && result?.storage === "d1",
      environment: result?.environment || "preview",
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      environment: null,
      error,
    };
  }
}

export function getCloudSession() {
  return apiFetch("/api/auth/session");
}

export function loginCloudSession(username, password) {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logoutCloudSession() {
  return apiFetch("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function loadCloudState() {
  return apiFetch("/api/state");
}

export function saveCloudState(state, expectedRevision) {
  return apiFetch("/api/state", {
    method: "PUT",
    body: JSON.stringify({ state, expectedRevision }),
  });
}
