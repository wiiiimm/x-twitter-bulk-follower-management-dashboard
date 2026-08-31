import { readBearerToken, unfollowUser } from "@/lib/x-api";

export async function POST(request: Request) {
  const token = readBearerToken(request);
  if (!token) {
    return Response.json(
      { ok: false, error: "Missing Authorization Bearer token." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const targetUserId = record && typeof record.targetUserId === "string" ? record.targetUserId : "";
  const sourceUserId =
    record && typeof record.sourceUserId === "string" ? record.sourceUserId.trim() : "";

  if (!targetUserId.trim()) {
    return Response.json(
      { ok: false, error: "targetUserId is required." },
      { status: 400 },
    );
  }

  const result = await unfollowUser(token, targetUserId.trim(), sourceUserId || undefined);
  if (!result.ok) {
    return Response.json(result, { status: result.status >= 400 ? result.status : 500 });
  }
  return Response.json(result);
}
