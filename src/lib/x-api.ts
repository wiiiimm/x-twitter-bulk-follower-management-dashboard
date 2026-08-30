import "server-only";

export type XUser = {
  id: string;
  username: string;
  name: string;
};

export type MeSuccess = {
  ok: true;
  user: XUser;
};

export type MeFailure = {
  ok: false;
  status: number;
  error: string;
  details: unknown;
};

export type MeResult = MeSuccess | MeFailure;

export type UnfollowSuccess = {
  ok: true;
  targetUserId: string;
  sourceUserId: string;
  following: boolean | null;
};

export type UnfollowFailure = {
  ok: false;
  targetUserId: string;
  status: number;
  error: string;
  details: unknown;
};

export type UnfollowResult = UnfollowSuccess | UnfollowFailure;

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  const token = match?.[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

export function formatXApiError(status: number, body: unknown, action: "me" | "unfollow"): string {
  const fallback =
    action === "me"
      ? `X API ${status}: could not resolve the signed-in user.`
      : `X API ${status}: unfollow was refused.`;
  if (!body || typeof body !== "object") {
    if (typeof body === "string" && body.trim()) {
      return `X API ${status}: ${body.trim()}`;
    }
    return fallback;
  }

  const record = body as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.title === "string" && record.title.trim()) {
    parts.push(record.title.trim());
  }
  if (typeof record.detail === "string" && record.detail.trim()) {
    parts.push(record.detail.trim());
  }
  if (Array.isArray(record.errors)) {
    for (const item of record.errors) {
      if (item && typeof item === "object" && "message" in item) {
        const message = (item as { message?: unknown }).message;
        if (typeof message === "string" && message.trim()) {
          parts.push(message.trim());
        }
      } else if (typeof item === "string" && item.trim()) {
        parts.push(item.trim());
      }
    }
  }

  const joined = parts.join(" — ");
  const suffix = (() => {
    switch (action) {
      case "unfollow":
        return status === 403
          ? " Self-serve X apps are often blocked from follows.write even though the endpoint is documented."
          : "";
      case "me":
        return "";
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  })();
  if (!joined) return `${fallback}${suffix}`;
  return `X API ${status}: ${joined}.${suffix}`;
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

function parseUser(body: unknown): XUser | null {
  if (!body || typeof body !== "object" || !("data" in body)) return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const record = data as { id?: unknown; username?: unknown; name?: unknown };
  if (typeof record.id !== "string" || record.id.trim() === "") return null;
  if (typeof record.username !== "string" || record.username.trim() === "") return null;
  return {
    id: record.id.trim(),
    username: record.username.trim(),
    name: typeof record.name === "string" ? record.name.trim() : "",
  };
}

export async function fetchAuthenticatedUser(token: string): Promise<MeResult> {
  let response: Response;
  try {
    response = await fetch("https://api.x.com/2/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: error instanceof Error ? error.message : "Network error calling the X API.",
      details: null,
    };
  }

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: formatXApiError(response.status, parsed, "me"),
      details: parsed,
    };
  }

  const user = parseUser(parsed);
  if (!user) {
    return {
      ok: false,
      status: 502,
      error: "X API returned an unexpected /2/users/me payload.",
      details: parsed,
    };
  }

  return { ok: true, user };
}

export async function unfollowUser(token: string, targetUserId: string): Promise<UnfollowResult> {
  const me = await fetchAuthenticatedUser(token);
  if (!me.ok) {
    return {
      ok: false,
      targetUserId,
      status: me.status,
      error: me.error,
      details: me.details,
    };
  }

  if (targetUserId === me.user.id) {
    return {
      ok: false,
      targetUserId,
      status: 400,
      error: "Refusing to unfollow the signed-in account.",
      details: null,
    };
  }

  const url = `https://api.x.com/2/users/${encodeURIComponent(me.user.id)}/following/${encodeURIComponent(targetUserId)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      targetUserId,
      status: 502,
      error: error instanceof Error ? error.message : "Network error calling the X API.",
      details: null,
    };
  }

  const parsed = await parseResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      targetUserId,
      status: response.status,
      error: formatXApiError(response.status, parsed, "unfollow"),
      details: parsed,
    };
  }

  const following =
    parsed &&
    typeof parsed === "object" &&
    "data" in parsed &&
    parsed.data &&
    typeof parsed.data === "object" &&
    "following" in parsed.data
      ? Boolean((parsed.data as { following: unknown }).following)
      : null;

  return {
    ok: true,
    targetUserId,
    sourceUserId: me.user.id,
    following,
  };
}
