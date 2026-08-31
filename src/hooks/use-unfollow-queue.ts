use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";

import { readAccessToken } from "@/lib/browser-token";
import { displayHandle, type FollowRow } from "@/lib/follows";
import { refreshUserAccessToken } from "@/lib/oauth-client";
import {
  emptyRateLimit,
  parseRateLimitPayload,
  recordUnfollowAttempt,
  sleepMs,
  waitMsForUnfollow,
  type RateLimitInfo,
} from "@/lib/unfollow-pace";
import { getWhitelistSnapshot } from "@/lib/whitelist";

type QueueUser = {
  id: string;
  username: string;
  name: string;
};

export type QueueJob =
  | { kind: "idle" }
  | {
      kind: "waiting";
      completed: number;
      total: number;
      handle: string;
      until: number;
      reason: "pace" | "rate-limit";
    }
  | { kind: "working"; completed: number; total: number; handle: string }
  | { kind: "paused"; remaining: number; completed: number; total: number };

type UnfollowCallResult =
  | { ok: true; rateLimit: RateLimitInfo | null }
  | { ok: false; status: number; error: string; rateLimit: RateLimitInfo | null };

function dedupeRows(rows: FollowRow[]): FollowRow[] {
  const seen = new Set<string>();
  const next: FollowRow[] = [];
  for (const row of rows) {
    if (seen.has(row.accountId)) continue;
    seen.add(row.accountId);
    next.push(row);
  }
  return next;
}

async function postUnfollow(
  targetUserId: string,
  sourceUserId: string,
): Promise<UnfollowCallResult> {
  async function send(token: string): Promise<Response> {
    return fetch("/api/unfollow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ targetUserId, sourceUserId }),
    });
  }

  let token = readAccessToken();
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Not signed in. Generate an access token on the login screen.",
      rateLimit: null,
    };
  }
  let response = await send(token);
  if (response.status === 401) {
    const refreshed = await refreshUserAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await send(token);
    }
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const rateLimit =
    payload && typeof payload === "object" && "rateLimit" in payload
      ? parseRateLimitPayload((payload as { rateLimit: unknown }).rateLimit)
      : null;
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Unfollow failed (${response.status}).`;
    return { ok: false, status: response.status, error, rateLimit };
  }
  return { ok: true, rateLimit };
}

export function useUnfollowQueue({
  user,
  whitelisted,
  setRows,
  setSelectedIds,
  setActionError,
}: {
  user: QueueUser;
  whitelisted: Set<string>;
  setRows: Dispatch<SetStateAction<FollowRow[]>>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
}) {
  const queueRef = useRef<FollowRow[]>([]);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const pausedRef = useRef(true);
  const inFlightIdRef = useRef<string | null>(null);
  const lastRateLimitRef = useRef<RateLimitInfo | null>(null);

  const [job, setJob] = useState<QueueJob>({ kind: "paused", remaining: 0, completed: 0, total: 0 });
  const [queuedRows, setQueuedRows] = useState<FollowRow[]>([]);
  const [inFlightId, setInFlightId] = useState<string | null>(null);
  const [sessionUnfollowed, setSessionUnfollowed] = useState(0);

  function writeQueue(next: FollowRow[]) {
    queueRef.current = next;
    setQueuedRows(next);
  }

  function setInFlight(accountId: string | null) {
    inFlightIdRef.current = accountId;
    setInFlightId(accountId);
  }

  function bumpJobFromQueue() {
    setJob((current) => {
      const remaining = queueRef.current.length;
      const nextHandle = queueRef.current[0]
        ? displayHandle(queueRef.current[0].handle)
        : null;
      switch (current.kind) {
        case "idle":
          return {
            kind: "paused",
            remaining,
            completed: 0,
            total: remaining,
          };
        case "paused":
          return {
            ...current,
            remaining,
            total: current.completed + remaining,
          };
        case "waiting":
        case "working":
          return {
            ...current,
            handle: nextHandle ?? current.handle,
            total: current.completed + remaining,
          };
        default: {
          const exhaustive: never = current;
          return exhaustive;
        }
      }
    });
  }

  async function runQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    const failures: string[] = [];
    let completed = 0;

    while (queueRef.current.length > 0 && !abortRef.current) {
      const target = queueRef.current[0];
      if (getWhitelistSnapshot().includes(target.accountId) || target.accountId === user.id) {
        writeQueue(queueRef.current.filter((row) => row.accountId !== target.accountId));
        bumpJobFromQueue();
        continue;
      }

      const waitMs = waitMsForUnfollow(Date.now(), lastRateLimitRef.current);
      if (waitMs > 0) {
        const until = Date.now() + waitMs;
        const reason =
          lastRateLimitRef.current?.remaining === 0 ||
          (lastRateLimitRef.current?.retryAfterSeconds ?? 0) > 0
            ? "rate-limit"
            : "pace";
        setJob({
          kind: "waiting",
          completed,
          total: completed + queueRef.current.length,
          handle: displayHandle(target.handle),
          until,
          reason,
        });
        const slept = await sleepMs(waitMs, () => abortRef.current);
        lastRateLimitRef.current = null;
        if (slept === "aborted") break;
      }

      if (abortRef.current) break;

      const current = queueRef.current[0];
      if (!current) break;
      if (current.accountId !== target.accountId) {
        continue;
      }
      if (getWhitelistSnapshot().includes(current.accountId) || current.accountId === user.id) {
        writeQueue(queueRef.current.filter((row) => row.accountId !== current.accountId));
        bumpJobFromQueue();
        continue;
      }

      setInFlight(current.accountId);
      setJob({
        kind: "working",
        completed,
        total: completed + queueRef.current.length,
        handle: displayHandle(current.handle),
      });

      const result = await postUnfollow(current.accountId, user.id);
      setInFlight(null);
      recordUnfollowAttempt();
      lastRateLimitRef.current = result.rateLimit;

      if (!result.ok && result.status === 429) {
        if (
          !lastRateLimitRef.current ||
          (lastRateLimitRef.current.retryAfterSeconds == null &&
            lastRateLimitRef.current.resetAt == null &&
            lastRateLimitRef.current.remaining !== 0)
        ) {
          lastRateLimitRef.current = {
            ...emptyRateLimit(),
            remaining: 0,
            retryAfterSeconds: 60,
          };
        }
        continue;
      }

      writeQueue(queueRef.current.filter((row) => row.accountId !== current.accountId));
      completed += 1;
      setJob((currentJob) => {
        switch (currentJob.kind) {
          case "idle":
            return currentJob;
          case "paused":
            return {
              ...currentJob,
              completed,
              remaining: queueRef.current.length,
              total: completed + queueRef.current.length,
            };
          case "waiting":
          case "working":
            return {
              ...currentJob,
              completed,
              total: completed + queueRef.current.length,
              handle: queueRef.current[0]
                ? displayHandle(queueRef.current[0].handle)
                : currentJob.handle,
            };
          default: {
            const exhaustive: never = currentJob;
            return exhaustive;
          }
        }
      });

      if (result.ok) {
        setSessionUnfollowed((count) => count + 1);
        setRows((currentRows) => currentRows.filter((row) => row.accountId !== current.accountId));
        setSelectedIds((selected) => {
          const next = new Set(selected);
          next.delete(current.accountId);
          return next;
        });
      } else {
        failures.push(`${displayHandle(current.handle)}: ${result.error}`);
        setActionError(failures.join("\n"));
      }
    }

    setInFlight(null);
    runningRef.current = false;
    pausedRef.current = true;
    setJob({
      kind: "paused",
      remaining: queueRef.current.length,
      completed,
      total: completed + queueRef.current.length,
    });
    if (failures.length > 0) {
      setActionError(failures.join("\n"));
    }
  }

  function enqueueUnfollows(targets: FollowRow[]) {
    const allowed = dedupeRows(
      targets.filter((row) => !whitelisted.has(row.accountId) && row.accountId !== user.id),
    );
    if (allowed.length === 0) return;
    const queuedIds = new Set(queueRef.current.map((row) => row.accountId));
    const added = allowed.filter((row) => !queuedIds.has(row.accountId));
    if (added.length === 0) return;
    writeQueue([...queueRef.current, ...added]);
    bumpJobFromQueue();
    setActionError(null);
  }

  function removeQueued(accountId: string) {
    if (inFlightIdRef.current === accountId) return;
    const next = queueRef.current.filter((row) => row.accountId !== accountId);
    if (next.length === queueRef.current.length) return;
    writeQueue(next);
    if (next.length === 0) {
      if (runningRef.current) {
        abortRef.current = true;
      }
      pausedRef.current = true;
      setJob((current) => ({
        kind: "paused",
        remaining: 0,
        completed: current.kind === "idle" ? 0 : current.completed,
        total: current.kind === "idle" ? 0 : current.completed,
      }));
      return;
    }
    bumpJobFromQueue();
  }

  function dropQueuedIds(ids: Iterable<string>) {
    const blocked = new Set(ids);
    writeQueue(queueRef.current.filter((row) => !blocked.has(row.accountId)));
    bumpJobFromQueue();
    if (queueRef.current.length === 0) {
      if (runningRef.current) {
        abortRef.current = true;
      }
      pausedRef.current = true;
      setJob((current) => ({
        kind: "paused",
        remaining: 0,
        completed: current.kind === "idle" ? 0 : current.completed,
        total: current.kind === "idle" ? 0 : current.completed,
      }));
    }
  }

  function pauseQueue() {
    pausedRef.current = true;
    abortRef.current = true;
  }

  function resumeQueue() {
    pausedRef.current = false;
    abortRef.current = false;
    if (queueRef.current.length === 0) return;
    void runQueue();
  }

  function clearQueue() {
    pausedRef.current = true;
    abortRef.current = true;
    setInFlight(null);
    writeQueue([]);
    setJob((current) => ({
      kind: "paused",
      remaining: 0,
      completed: current.kind === "idle" ? 0 : current.completed,
      total: current.kind === "idle" ? 0 : current.completed,
    }));
  }

  return {
    job,
    queuedRows,
    inFlightId,
    sessionUnfollowed,
    enqueueUnfollows,
    removeQueued,
    dropQueuedIds,
    pauseQueue,
    resumeQueue,
    clearQueue,
  };
}
