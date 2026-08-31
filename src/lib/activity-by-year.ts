import { toDatetimeLocalValue, type FollowRow } from "@/lib/follows";

export const UNKNOWN_YEAR_KEY = "unknown";

export type ActivityYearBucket = {
  key: string;
  year: number | null;
  label: string;
  tick: string;
  count: number;
};

const TWITTER_START_YEAR = 2006;

export function lastActiveUtcYear(iso: string | null): number | null {
  if (!iso) return null;
  const posted = new Date(iso);
  if (Number.isNaN(posted.getTime())) return null;
  return posted.getUTCFullYear();
}

export function activityByYear(rows: FollowRow[], now = new Date()): ActivityYearBucket[] {
  let unknown = 0;
  const counts = new Map<number, number>();
  let minYear: number | null = null;

  for (const row of rows) {
    const year = lastActiveUtcYear(row.lastPostAt);
    if (year == null) {
      unknown += 1;
      continue;
    }
    counts.set(year, (counts.get(year) ?? 0) + 1);
    if (minYear == null || year < minYear) minYear = year;
  }

  const endYear = now.getUTCFullYear();
  const startYear = Math.max(minYear ?? endYear, TWITTER_START_YEAR);
  const buckets: ActivityYearBucket[] = [];

  if (unknown > 0) {
    buckets.push({
      key: UNKNOWN_YEAR_KEY,
      year: null,
      label: "Unknown / never",
      tick: "n/a",
      count: unknown,
    });
  }

  for (let year = startYear; year <= endYear; year++) {
    buckets.push({
      key: String(year),
      year,
      label: String(year),
      tick: String(year),
      count: counts.get(year) ?? 0,
    });
  }

  return buckets;
}

export function utcYearStartMs(year: number): number {
  return Date.UTC(year, 0, 1, 0, 0, 0);
}

/** Local datetime-local value for 1 Jan of the following UTC year. */
export function cutoffAfterYearLocal(year: number): string {
  return toDatetimeLocalValue(new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0)));
}

export function yearFullyBeforeCutoff(year: number, cutoff: Date | null): boolean {
  if (!cutoff) return true;
  return utcYearStartMs(year + 1) <= cutoff.getTime();
}
