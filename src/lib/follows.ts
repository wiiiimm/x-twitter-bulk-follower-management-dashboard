export type FollowRow = {
  accountId: string;
  handle: string;
  name: string;
  lastPostAt: string | null;
  status: string;
  url: string;
};

/** Bounds for the cutoff picker so the native calendar cannot spin into garbage years. */
export const CUTOFF_MIN_LOCAL = "2006-03-21T00:00";
export const CUTOFF_MAX_LOCAL = "2030-12-31T23:59";

export function parseCutoff(localValue: string): Date | null {
  if (!localValue) return null;
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function clampCutoffLocal(localValue: string): string {
  if (!localValue) return localValue;
  if (localValue < CUTOFF_MIN_LOCAL) return CUTOFF_MIN_LOCAL;
  if (localValue > CUTOFF_MAX_LOCAL) return CUTOFF_MAX_LOCAL;
  return localValue;
}

export function formatCutoffLocal(localValue: string): string {
  const parsed = parseCutoff(localValue);
  if (!parsed) return "";
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function daysAgoLocal(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setSeconds(0, 0);
  return toDatetimeLocalValue(date);
}

export function isBeforeCutoff(row: FollowRow, cutoff: Date | null): boolean {
  if (!cutoff) return true;
  if (!row.lastPostAt) return true;
  const posted = new Date(row.lastPostAt);
  if (Number.isNaN(posted.getTime())) return true;
  return posted < cutoff;
}

export function formatLastPost(iso: string | null): string {
  if (!iso) return "Never / unknown";
  const posted = new Date(iso);
  if (Number.isNaN(posted.getTime())) return "Never / unknown";
  return `${new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(posted)} UTC`;
}

export function profileUrl(row: FollowRow): string {
  if (row.url) return row.url;
  if (row.handle) return `https://x.com/${row.handle}`;
  return `https://x.com/i/user/${row.accountId}`;
}

export function displayHandle(handle: string): string {
  if (!handle) return "(no handle)";
  return handle.startsWith("@") ? handle : `@${handle}`;
}
