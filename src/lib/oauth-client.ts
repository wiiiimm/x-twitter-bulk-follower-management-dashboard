import {
  hasOAuth2Client,
  readAppCredentials,
  readRefreshToken,
  writeStoredTokens,
  type AppCredentials,
} from "@/lib/browser-token";

type TokenPayload = {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresIn?: unknown;
  error?: unknown;
};

function errorFromPayload(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error.trim();
  }
  return fallback;
}

function persistTokens(payload: TokenPayload, previousRefresh: string | null): string | null {
  if (typeof payload.accessToken !== "string" || payload.accessToken.trim() === "") {
    return null;
  }
  const expiresIn =
    typeof payload.expiresIn === "number" && Number.isFinite(payload.expiresIn)
      ? payload.expiresIn
      : null;
  const nextRefresh =
    typeof payload.refreshToken === "string" && payload.refreshToken.trim()
      ? payload.refreshToken.trim()
      : previousRefresh;
  writeStoredTokens({
    accessToken: payload.accessToken.trim(),
    refreshToken: nextRefresh,
    expiresAt: expiresIn == null ? null : Date.now() + Math.max(expiresIn - 60, 30) * 1000,
  });
  return payload.accessToken.trim();
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  credentials: AppCredentials;
}): Promise<{ ok: true; accessToken: string } | { ok: false; error: string }> {
  const response = await fetch("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      grant: "authorization_code",
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      clientId: input.credentials.clientId,
      clientSecret: input.credentials.clientSecret,
    }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    return {
      ok: false,
      error: errorFromPayload(payload, `Could not exchange the X login code (${response.status}).`),
    };
  }
  const accessToken = persistTokens(payload as TokenPayload, null);
  if (!accessToken) {
    return { ok: false, error: "X OAuth returned an unexpected token payload." };
  }
  return { ok: true, accessToken };
}

export async function refreshUserAccessToken(): Promise<string | null> {
  const credentials = readAppCredentials();
  const refreshToken = readRefreshToken();
  if (!hasOAuth2Client(credentials) || !refreshToken) return null;

  const response = await fetch("/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      grant: "refresh_token",
      refreshToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) return null;
  return persistTokens(payload as TokenPayload, refreshToken);
}
