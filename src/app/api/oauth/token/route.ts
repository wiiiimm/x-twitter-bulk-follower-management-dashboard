import { exchangeXOauthToken, type TokenGrant } from "@/lib/x-oauth";

const MAX_FIELD = 2048;

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FIELD) return null;
  return trimmed;
}

function parseGrant(body: unknown): TokenGrant | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be JSON." };
  }
  const record = body as Record<string, unknown>;
  const clientId = readString(record.clientId);
  const clientSecret = readString(record.clientSecret);
  if (!clientId) return { error: "clientId is required." };
  if (!clientSecret) return { error: "clientSecret is required." };

  const grant = readString(record.grant);
  switch (grant) {
    case "authorization_code": {
      const code = readString(record.code);
      const codeVerifier = readString(record.codeVerifier);
      const redirectUri = readString(record.redirectUri);
      if (!code) return { error: "code is required." };
      if (!codeVerifier) return { error: "codeVerifier is required." };
      if (!redirectUri) return { error: "redirectUri is required." };
      return {
        grant: "authorization_code",
        code,
        codeVerifier,
        redirectUri,
        clientId,
        clientSecret,
      };
    }
    case "refresh_token": {
      const refreshToken = readString(record.refreshToken);
      if (!refreshToken) return { error: "refreshToken is required." };
      return {
        grant: "refresh_token",
        refreshToken,
        clientId,
        clientSecret,
      };
    }
    default:
      return { error: "grant must be authorization_code or refresh_token." };
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Request body must be JSON." }, { status: 400 });
  }

  const grant = parseGrant(body);
  if ("error" in grant) {
    return Response.json({ ok: false, error: grant.error }, { status: 400 });
  }

  const result = await exchangeXOauthToken(grant);
  if (!result.ok) {
    return Response.json(result, { status: result.status >= 400 ? result.status : 500 });
  }
  return Response.json(result);
}
