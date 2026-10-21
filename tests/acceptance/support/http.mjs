const rawBaseUrl = process.env.ACCEPTANCE_BASE_URL ?? "";

/** The suite is skipped unless a disposable, already-mounted backend is supplied. */
export const baseUrl = rawBaseUrl.replace(/\/+$/, "");
export const enabled = baseUrl.length > 0;

export function cookieAttributes(raw) {
  const parts = raw.split(";").map((part) => part.trim());
  const pair = parts.shift() ?? "";
  const separator = pair.indexOf("=");
  const attributes = new Map();
  for (const part of parts) {
    const index = part.indexOf("=");
    const key = (index === -1 ? part : part.slice(0, index)).trim().toLowerCase();
    const value = index === -1 ? "" : part.slice(index + 1).trim();
    attributes.set(key, value);
  }
  return {
    raw,
    pair,
    name: separator === -1 ? "" : pair.slice(0, separator),
    value: separator === -1 ? "" : pair.slice(separator + 1),
    httpOnly: attributes.has("httponly"),
    sameSite: attributes.get("samesite") ?? null,
    secure: attributes.has("secure"),
    path: attributes.get("path") ?? null,
    maxAge: attributes.get("max-age") ?? null,
    expires: attributes.get("expires") ?? null,
    attributes,
  };
}

function setCookiesFrom(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  return values.flatMap((value) => {
    // A single header can contain multiple cookies separated by commas.
    return value.split(/,(?=\s*[^;,=\s]+=)/).map((part) => cookieAttributes(part.trim()));
  });
}

export async function request(path, options = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    if (!headers.has("origin")) headers.set("origin", new URL(baseUrl).origin);
    if (!headers.has("sec-fetch-site")) headers.set("sec-fetch-site", "same-origin");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  const setCookies = setCookiesFrom(response);
  return {
    response,
    status: response.status,
    headers: response.headers,
    body,
    text,
    setCookies,
    cookie: setCookies.map((item) => item.pair).join("; "),
  };
}

export async function loginEmail(email, password) {
  return request("/api/auth/login", { method: "POST", body: { email, password } });
}

export async function loginUsername(username, password) {
  return request("/api/auth/login", { method: "POST", body: { username, password } });
}

export function session(cookie) {
  return request("/api/auth/session", { cookie });
}

export function logout(cookie) {
  return request("/api/auth/logout", { method: "POST", cookie });
}

export function problemCode(body) {
  return body && typeof body === "object" ? body?.error?.code : undefined;
}

export function assertNoTokens(body) {
  if (!body || typeof body !== "object") return;
  for (const key of ["token", "access_token", "refresh_token", "accessToken", "refreshToken"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new Error(`Session response exposes forbidden field: ${key}`);
    }
  }
}

export function assertSessionCookie(result) {
  if (result.setCookies.length === 0) {
    throw new Error("Login did not set a cookie");
  }
  if (!result.setCookies.every((item) => item.httpOnly)) {
    throw new Error("Every cookie set by login must be HttpOnly");
  }
  if (!result.setCookies.every((item) => item.sameSite)) {
    throw new Error("Every cookie set by login must declare SameSite");
  }
  if (baseUrl.startsWith("https://")) {
    const secure = result.setCookies.find((item) => item.secure);
    if (!secure) throw new Error("HTTPS session cookie is missing Secure");
  }
  return result.setCookies.map((item) => item.pair).join("; ");
}
