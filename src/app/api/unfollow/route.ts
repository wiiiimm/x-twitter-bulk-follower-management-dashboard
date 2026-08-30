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

  const targetUserId =
    body && typeof body === "object" && "targetUserId" in body
      ? (body as { targetUserId?: unknown }).targetUserId
      : undefined;

  if (typeof targetUserId !== "string" || !targetUserId.trim()) {
    return Response.json(
      { ok: false, error: "targetUserId is required." },
      { status: 400 },
    );
  }

  const result = await unfollowUser(token, targetUserId.trim());
  if (!result.ok) {
    return Response.json(result, { status: result.status >= 400 ? result.status : 500 });
  }
  return Response.json(result);
}
