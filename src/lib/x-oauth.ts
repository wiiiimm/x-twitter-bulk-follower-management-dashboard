import "server-only";

import { X_TOKEN_URL } from "@/lib/oauth";

export type OAuthTokenSuccess = {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
};

export type OAuthTokenFailure = {
  ok: false;
  status: number;
  error: string;
  details: unknown;
};

export type OAuthTokenResult = OAuthTokenSuccess | OAuthTokenFailure;

export type AuthorizationCodeGrant = {
  grant: "authorization_code";
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
};

export type RefreshTokenGrant = {
  grant: "refresh_token";
  refreshToken: string;
  clientId: string;
  clientSecret: string;
};

export type TokenGrant = AuthorizationCodeGrant | RefreshTokenGrant;

function formatTokenError(status: number, body: unknown): string {
  if (!body || typeof body !== "object") {
    if (typeof body === "string" && body.trim()) {
      return `X OAuth ${status}: ${body.trim()}`;
    }
    return `X OAuth ${status}: token request failed.`;
  }
  const record = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.error_description === "string" && record.error_description.trim()) {
    parts.push(record.error_description.trim());
  }
  if (typeof record.error === "string" && record.error.trim()) {
    parts.push(record.error.trim());
  }
  if (typeof record.detail === "string" && record.detail.trim()) {
    parts.push(record.detail.trim());
  }
  const joined = parts.join(" — ");
  if (!joined) return `X OAuth ${status}: token request failed.`;
  return `X OAuth ${status}: ${joined}`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const rawText = await response.text();
  if (!rawText) return null;
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

function parseTokenPayload(body: unknown): OAuthTokenSuccess | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (typeof record.access_token !== "string" || record.access_token.trim() === "") {
    return null;
  }
  const expiresIn =
    typeof record.expires_in === "number" && Number.isFinite(record.expires_in)
      ? record.expires_in
      : null;
  return {
    ok: true,
    accessToken: record.access_token.trim(),
    refreshToken:
      typeof record.refresh_token === "string" && record.refresh_token.trim()
        ? record.refresh_token.trim()
        : null,
    expiresIn,
    scope: typeof record.scope === "string" ? record.scope : null,
    tokenType: typeof record.token_type === "string" ? record.token_type : null,
  };
}

function grantForm(grant: TokenGrant): URLSearchParams {
  switch (grant.grant) {
    case "authorization_code": {
      const body = new URLSearchParams();
      body.set("grant_type", "authorization_code");
      body.set("code", grant.code);
      body.set("redirect_uri", grant.redirectUri);
      body.set("code_verifier", grant.codeVerifier);
      body.set("client_id", grant.clientId);
      return body;
    }
    case "refresh_token": {
      const body = new URLSearchParams();
      body.set("grant_type", "refresh_token");
      body.set("refresh_token", grant.refreshToken);
      body.set("client_id", grant.clientId);
      return body;
    }
    default: {
      const exhaustive: never = grant;
      return exhaustive;
    }
  }
}

export async function exchangeXOauthToken(grant: TokenGrant): Promise<OAuthTokenResult> {
  const body = grantForm(grant);
  const basic = Buffer.from(`${grant.clientId}:${grant.clientSecret}`, "utf8").toString(
    "base64",
  );

  let response: Response;
  try {
    response = await fetch(X_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "Network error calling the X token endpoint.",
      details: null,
    };
  }

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: formatTokenError(response.status, parsed),
      details: parsed,
    };
  }

  const tokens = parseTokenPayload(parsed);
  if (!tokens) {
    return {
      ok: false,
      status: 502,
      error: "X OAuth returned an unexpected token payload.",
      details: parsed,
    };
  }
  return tokens;
}
