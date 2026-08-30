import { fetchAuthenticatedUser, readBearerToken } from "@/lib/x-api";

export async function GET(request: Request) {
  const token = readBearerToken(request);
  if (!token) {
    return Response.json(
      { ok: false, error: "Missing Authorization Bearer token." },
      { status: 401 },
    );
  }

  const result = await fetchAuthenticatedUser(token);
  if (!result.ok) {
    return Response.json(result, { status: result.status >= 400 ? result.status : 500 });
  }
  return Response.json(result);
}
