// Deployment-level access token for this app's /api routes. Stored per browser
// in localStorage (NOT per config profile, NOT encrypted) — it authorizes the
// caller to this deployment, it is not an upstream provider secret.

const ACCESS_TOKEN_STORAGE_KEY = "chat-app-access-token";

export function getAccessToken(): string {
  try {
    return globalThis.localStorage?.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAccessToken(token: string): void {
  try {
    if (token) {
      globalThis.localStorage?.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    } else {
      globalThis.localStorage?.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    }
  } catch {
    // pass — worst case the token isn't persisted
  }
}

// Header object to spread into a fetch to this app's /api routes. Empty when
// no token is set, so it is a no-op for the default open deployment.
export function accessTokenHeader(): Record<string, string> {
  const token = getAccessToken();
  return token ? { "x-access-token": token } : {};
}
