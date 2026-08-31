const ACCESS_TOKEN_KEY = "x-twitter-bulk-follower-management-dashboard.accessToken";
const REFRESH_TOKEN_KEY = "x-twitter-bulk-follower-management-dashboard.refreshToken";
const TOKEN_EXPIRES_AT_KEY =
  "x-twitter-bulk-follower-management-dashboard.tokenExpiresAt";
const APP_CREDENTIALS_KEY =
  "x-twitter-bulk-follower-management-dashboard.appCredentials";

export type AppCredentials = {
  apiKey: string;
  apiSecret: string;
  clientId: string;
  clientSecret: string;
};

export type StoredTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
};

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(key);
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function readAccessToken(): string | null {
  return readStorage(ACCESS_TOKEN_KEY);
}

export function writeAccessToken(token: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token.trim());
}

export function clearAccessToken(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function readRefreshToken(): string | null {
  return readStorage(REFRESH_TOKEN_KEY);
}

export function writeRefreshToken(token: string | null): void {
  if (!token || token.trim() === "") {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(REFRESH_TOKEN_KEY, token.trim());
}

export function readTokenExpiresAt(): number | null {
  const raw = readStorage(TOKEN_EXPIRES_AT_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function writeTokenExpiresAt(expiresAt: number | null): void {
  if (expiresAt == null) {
    window.localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
    return;
  }
  window.localStorage.setItem(TOKEN_EXPIRES_AT_KEY, String(expiresAt));
}

export function writeStoredTokens(tokens: StoredTokens): void {
  writeAccessToken(tokens.accessToken);
  writeRefreshToken(tokens.refreshToken);
  writeTokenExpiresAt(tokens.expiresAt);
}

export function clearUserSession(): void {
  clearAccessToken();
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_EXPIRES_AT_KEY);
}

const EMPTY_CREDENTIALS: AppCredentials = Object.freeze({
  apiKey: "",
  apiSecret: "",
  clientId: "",
  clientSecret: "",
});

const credentialListeners = new Set<() => void>();
let credentialsSnapshot: AppCredentials = EMPTY_CREDENTIALS;
let credentialsLoaded = false;

function emitCredentials(): void {
  for (const listener of credentialListeners) listener();
}

function parseCredentials(raw: string | null): AppCredentials {
  if (!raw) return EMPTY_CREDENTIALS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY_CREDENTIALS;
    const record = parsed as Record<string, unknown>;
    const next: AppCredentials = {
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      apiSecret: typeof record.apiSecret === "string" ? record.apiSecret : "",
      clientId: typeof record.clientId === "string" ? record.clientId : "",
      clientSecret: typeof record.clientSecret === "string" ? record.clientSecret : "",
    };
    if (!next.apiKey && !next.apiSecret && !next.clientId && !next.clientSecret) {
      return EMPTY_CREDENTIALS;
    }
    return next;
  } catch {
    return EMPTY_CREDENTIALS;
  }
}

export function emptyAppCredentials(): AppCredentials {
  return { apiKey: "", apiSecret: "", clientId: "", clientSecret: "" };
}

export function subscribeAppCredentials(onStoreChange: () => void): () => void {
  credentialListeners.add(onStoreChange);
  return () => {
    credentialListeners.delete(onStoreChange);
  };
}

export function getAppCredentialsSnapshot(): AppCredentials {
  if (typeof window === "undefined") return EMPTY_CREDENTIALS;
  if (!credentialsLoaded) {
    credentialsSnapshot = parseCredentials(window.localStorage.getItem(APP_CREDENTIALS_KEY));
    credentialsLoaded = true;
  }
  return credentialsSnapshot;
}

export function getServerAppCredentialsSnapshot(): AppCredentials {
  return EMPTY_CREDENTIALS;
}

export function readAppCredentials(): AppCredentials {
  return getAppCredentialsSnapshot();
}

export function writeAppCredentials(credentials: AppCredentials): void {
  const next: AppCredentials = {
    apiKey: credentials.apiKey.trim(),
    apiSecret: credentials.apiSecret.trim(),
    clientId: credentials.clientId.trim(),
    clientSecret: credentials.clientSecret.trim(),
  };
  window.localStorage.setItem(APP_CREDENTIALS_KEY, JSON.stringify(next));
  credentialsSnapshot = next;
  credentialsLoaded = true;
  emitCredentials();
}

export function clearAppCredentials(): void {
  window.localStorage.removeItem(APP_CREDENTIALS_KEY);
  credentialsSnapshot = EMPTY_CREDENTIALS;
  credentialsLoaded = true;
  emitCredentials();
}

export function hasOAuth2Client(credentials: AppCredentials): boolean {
  return credentials.clientId.trim().length > 0 && credentials.clientSecret.trim().length > 0;
}
