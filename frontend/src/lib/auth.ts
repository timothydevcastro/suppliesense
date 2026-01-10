// frontend/src/lib/auth.ts

export type UserRole = "manager" | "viewer";

export type AuthUser = {
  name: string;
  role: UserRole;
  username?: string;
  email?: string;
};

const TOKEN_KEY = "suppliesense_access_token";
const USER_KEY = "suppliesense_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && t.trim() ? t : null;
  } catch {
    return null;
  }
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed?.name || !parsed?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: AuthUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Builds headers for authenticated API calls.
 * Returns HeadersInit (not a plain object) to avoid TS "No overload matches this call".
 */
export function authHeaders(extra?: Record<string, string>): HeadersInit {
  const headers = new Headers(extra ?? {});
  const t = getToken();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  return headers;
}

/**
 * fetch() wrapper that:
 * - adds Authorization header
 * - redirects to /login on 401 (and clears local auth)
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const merged = new Headers(init.headers);

  // attach bearer token if exists
  const t = getToken();
  if (t && !merged.has("Authorization")) {
    merged.set("Authorization", `Bearer ${t}`);
  }

  // keep default JSON if caller sets body and didn't set content-type
  if (init.body && !merged.has("Content-Type")) {
    merged.set("Content-Type", "application/json");
  }

  const res = await fetch(input, { ...init, headers: merged });

  // if token expired / missing, kick to login
  if (res.status === 401 && typeof window !== "undefined") {
    clearAuth();
    window.location.href = "/login";
  }

  return res;
}
