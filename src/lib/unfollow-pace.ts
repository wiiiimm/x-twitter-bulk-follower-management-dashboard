export const UNFOLLOW_LIMIT_PER_WINDOW = 50;
export const UNFOLLOW_WINDOW_MS = 15 * 60 * 1000;
/** Stay well under 50/15min: about 8–20 unfollows per window. */
export const UNFOLLOW_SOFT_CAP_PER_WINDOW = 20;
export const UNFOLLOW_GAP_MIN_MS = 45_000;
export const UNFOLLOW_GAP_MAX_MS = 110_000;
export const UNFOLLOW_JITTER_MIN_MS = 5_000;
export const UNFOLLOW_JITTER_MAX_MS = 20_000;

const ATTEMPT_TIMES_KEY =
  "x-twitter-bulk-follower-management-dashboard.unfollowAttemptTimes";

export type RateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
  retryAfterSeconds: number | null;
};

export function parseOptionalInt(value: string | null): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readRateLimitHeaders(headers: Headers): RateLimitInfo {
  const resetSeconds = parseOptionalInt(headers.get("x-rate-limit-reset"));
  return {
    limit: parseOptionalInt(headers.get("x-rate-limit-limit")),
    remaining: parseOptionalInt(headers.get("x-rate-limit-remaining")),
    resetAt: resetSeconds == null ? null : resetSeconds * 1000,
    retryAfterSeconds: parseOptionalInt(headers.get("retry-after")),
  };
}

export function emptyRateLimit(): RateLimitInfo {
  return {
    limit: null,
    remaining: null,
    resetAt: null,
    retryAfterSeconds: null,
  };
}

export function parseRateLimitPayload(value: unknown): RateLimitInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return {
    limit: typeof record.limit === "number" ? record.limit : null,
    remaining: typeof record.remaining === "number" ? record.remaining : null,
    resetAt: typeof record.resetAt === "number" ? record.resetAt : null,
    retryAfterSeconds:
      typeof record.retryAfterSeconds === "number" ? record.retryAfterSeconds : null,
  };
}

export function randomIntInclusive(min: number, max: number): number {
  const low = Math.ceil(min);
  const high = Math.floor(max);
  return low + Math.floor(Math.random() * (high - low + 1));
}

export function randomUnfollowGapMs(): number {
  return randomIntInclusive(UNFOLLOW_GAP_MIN_MS, UNFOLLOW_GAP_MAX_MS);
}

export function randomJitterMs(): number {
  return randomIntInclusive(UNFOLLOW_JITTER_MIN_MS, UNFOLLOW_JITTER_MAX_MS);
}

export function formatGapRange(): string {
  return `${Math.round(UNFOLLOW_GAP_MIN_MS / 1000)}–${Math.round(UNFOLLOW_GAP_MAX_MS / 1000)}s`;
}

export function readUnfollowAttemptTimes(): number[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ATTEMPT_TIMES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  } catch {
    return [];
  }
}

export function recordUnfollowAttempt(at = Date.now()): void {
  if (typeof window === "undefined") return;
  const cutoff = at - UNFOLLOW_WINDOW_MS;
  const times = readUnfollowAttemptTimes().filter((time) => time > cutoff);
  times.push(at);
  window.localStorage.setItem(ATTEMPT_TIMES_KEY, JSON.stringify(times));
}

export function waitMsForUnfollow(
  now: number,
  rateLimit: RateLimitInfo | null,
  recentAttempts: number[] = readUnfollowAttemptTimes(),
  gapMs: number = randomUnfollowGapMs(),
): number {
  if (rateLimit?.retryAfterSeconds != null && rateLimit.retryAfterSeconds > 0) {
    return rateLimit.retryAfterSeconds * 1000 + randomJitterMs();
  }
  if (rateLimit?.remaining === 0 && rateLimit.resetAt != null) {
    return Math.max(rateLimit.resetAt - now, 0) + randomJitterMs();
  }
  const cutoff = now - UNFOLLOW_WINDOW_MS;
  const recent = recentAttempts.filter((time) => time > cutoff).sort((a, b) => a - b);
  if (recent.length >= UNFOLLOW_SOFT_CAP_PER_WINDOW) {
    return Math.max(recent[0] + UNFOLLOW_WINDOW_MS - now, 0) + randomJitterMs();
  }
  if (recent.length === 0) return gapMs;
  return Math.max(recent[recent.length - 1] + gapMs - now, 0);
}

export async function sleepMs(
  ms: number,
  shouldAbort: () => boolean,
  onTick?: (remainingMs: number) => void,
): Promise<"done" | "aborted"> {
  const end = Date.now() + Math.max(ms, 0);
  while (Date.now() < end) {
    if (shouldAbort()) return "aborted";
    const remaining = end - Date.now();
    onTick?.(remaining);
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  }
  return shouldAbort() ? "aborted" : "done";
}

export function formatWait(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
