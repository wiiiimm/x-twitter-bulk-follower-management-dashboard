export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";

export const OAUTH_SCOPES = [
  "tweet.read",
  "users.read",
  "follows.write",
  "offline.access",
] as const;

export const PKCE_SESSION_KEY =
  "x-twitter-bulk-follower-management-dashboard.pkce";
export const OAUTH_REDIRECT_ERROR_KEY =
  "x-twitter-bulk-follower-management-dashboard.oauthError";

export type PkceSession = {
  state: string;
  verifier: string;
  redirectUri: string;
  clientId: string;
};

export function oauthCallbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/oauth/callback`;
}

export function websiteUrl(origin: string): string {
  return origin.replace(/\/$/, "");
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export function buildXAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const scopes = input.scopes ?? OAUTH_SCOPES;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: scopes.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTHORIZE_URL}?${params.toString().replace(/\+/g, "%20")}`;
}

export function readPkceSession(): PkceSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(PKCE_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.state !== "string" || record.state.trim() === "") return null;
    if (typeof record.verifier !== "string" || record.verifier.trim() === "") return null;
    if (typeof record.redirectUri !== "string" || record.redirectUri.trim() === "") {
      return null;
    }
    if (typeof record.clientId !== "string" || record.clientId.trim() === "") return null;
    return {
      state: record.state.trim(),
      verifier: record.verifier.trim(),
      redirectUri: record.redirectUri.trim(),
      clientId: record.clientId.trim(),
    };
  } catch {
    return null;
  }
}

export function writePkceSession(session: PkceSession): void {
  window.sessionStorage.setItem(PKCE_SESSION_KEY, JSON.stringify(session));
}

export function clearPkceSession(): void {
  window.sessionStorage.removeItem(PKCE_SESSION_KEY);
}

export function writeOAuthRedirectError(message: string): void {
  window.sessionStorage.setItem(OAUTH_REDIRECT_ERROR_KEY, message.trim());
}

export function consumeOAuthRedirectError(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(OAUTH_REDIRECT_ERROR_KEY);
  window.sessionStorage.removeItem(OAUTH_REDIRECT_ERROR_KEY);
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}
