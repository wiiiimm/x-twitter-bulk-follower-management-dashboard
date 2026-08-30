const STORAGE_KEY = "x-twitter-bulk-follower-management-dashboard.accessToken";

export function readAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(STORAGE_KEY);
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function writeAccessToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token.trim());
}

export function clearAccessToken(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
