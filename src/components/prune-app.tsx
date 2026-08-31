"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseFollowsCsv } from "@/lib/csv";
import { readAccessToken } from "@/lib/browser-token";
import { refreshUserAccessToken } from "@/lib/oauth-client";
import {
  CUTOFF_MAX_LOCAL,
  CUTOFF_MIN_LOCAL,
  clampCutoffLocal,
  daysAgoLocal,
  displayHandle,
  formatCutoffLocal,
  formatLastPost,
  isBeforeCutoff,
  parseCutoff,
  profileUrl,
  toDatetimeLocalValue,
  type FollowRow,
} from "@/lib/follows";
import {
  UNFOLLOW_LIMIT_PER_WINDOW,
  emptyRateLimit,
  formatGapRange,
  formatWait,
  parseRateLimitPayload,
  recordUnfollowAttempt,
  sleepMs,
  waitMsForUnfollow,
  type RateLimitInfo,
} from "@/lib/unfollow-pace";
import {
  addToWhitelist,
  getServerWhitelistSnapshot,
  getWhitelistSnapshot,
  removeFromWhitelist,
  subscribeWhitelist,
} from "@/lib/whitelist";

export type SignedInUser = {
  id: string;
  username: string;
  name: string;
};

type QueueJob =
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

type ConfirmState =
  | { open: false }
  | { open: true; mode: "one"; row: FollowRow }
  | { open: true; mode: "selected"; rows: FollowRow[] };

function confirmTargets(state: ConfirmState): FollowRow[] {
  if (!state.open) return [];
  switch (state.mode) {
    case "one":
      return [state.row];
    case "selected":
      return state.rows;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function statusVariant(status: string): "outline" | "secondary" | "destructive" {
  switch (status) {
    case "active":
      return "outline";
    case "quiet":
      return "secondary";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
}

type UnfollowCallResult =
  | { ok: true; rateLimit: RateLimitInfo | null }
  | { ok: false; status: number; error: string; rateLimit: RateLimitInfo | null };

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

export function PruneApp({
  user,
  onLogout,
}: {
  user: SignedInUser;
  onLogout: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipCutoffUncheck = useRef(true);
  const queueRef = useRef<FollowRow[]>([]);
  const runningRef = useRef(false);
  const abortRef = useRef(false);
  const pausedRef = useRef(false);
  const lastRateLimitRef = useRef<RateLimitInfo | null>(null);
  const whitelistIds = useSyncExternalStore(
    subscribeWhitelist,
    getWhitelistSnapshot,
    getServerWhitelistSnapshot,
  );
  const whitelisted = useMemo(() => new Set(whitelistIds), [whitelistIds]);

  const [rows, setRows] = useState<FollowRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [cutoff, setCutoff] = useState(() => daysAgoLocal(90));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [job, setJob] = useState<QueueJob>({ kind: "idle" });
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (skipCutoffUncheck.current) {
      skipCutoffUncheck.current = false;
      return;
    }
    setSelectedIds(new Set());
  }, [cutoff]);

  useEffect(() => {
    if (job.kind !== "waiting") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [job.kind]);

  const cutoffDate = useMemo(() => parseCutoff(cutoff), [cutoff]);

  const filtered = useMemo(
    () => rows.filter((row) => isBeforeCutoff(row, cutoffDate)),
    [rows, cutoffDate],
  );

  const selectableFiltered = useMemo(
    () => filtered.filter((row) => !whitelisted.has(row.accountId)),
    [filtered, whitelisted],
  );

  const selectedFiltered = useMemo(
    () => selectableFiltered.filter((row) => selectedIds.has(row.accountId)),
    [selectableFiltered, selectedIds],
  );

  const whitelistedFilteredCount = filtered.length - selectableFiltered.length;

  const allSelectableChecked =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((row) => selectedIds.has(row.accountId));

  const applyCsvText = useCallback((text: string, name: string) => {
    const result = parseFollowsCsv(text);
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setRows(result.rows);
    setSkipped(result.skipped);
    setFileName(name);
    setLoadError(null);
    setSelectedIds(new Set());
    setActionError(null);
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      applyCsvText(text, file.name);
    };
    reader.onerror = () => {
      setLoadError("Could not read that file in the browser.");
    };
    reader.readAsText(file);
  }

  async function loadSample() {
    try {
      const response = await fetch("/sample-follows.csv");
      if (!response.ok) throw new Error(`Could not load sample CSV (${response.status}).`);
      const text = await response.text();
      applyCsvText(text, "sample-follows.csv");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load sample CSV.");
    }
  }

  function toggleOne(accountId: string, checked: boolean) {
    if (whitelisted.has(accountId)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  }

  function checkAllFiltered() {
    setSelectedIds(new Set(selectableFiltered.map((row) => row.accountId)));
  }

  function uncheckAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of selectableFiltered) next.delete(row.accountId);
      return next;
    });
  }

  function whitelistAccounts(targets: FollowRow[]) {
    const ids = targets.map((row) => row.accountId).filter((id) => !whitelisted.has(id));
    if (ids.length === 0) return;
    addToWhitelist(ids);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
    const blocked = new Set(ids);
    queueRef.current = queueRef.current.filter((row) => !blocked.has(row.accountId));
  }

  function removeWhitelist(accountId: string) {
    removeFromWhitelist(accountId);
  }

  async function runQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    abortRef.current = false;
    const failures: string[] = [];
    const totalAtStart = queueRef.current.length;
    let completed = 0;

    while (queueRef.current.length > 0 && !abortRef.current) {
      const target = queueRef.current[0];
      if (getWhitelistSnapshot().includes(target.accountId) || target.accountId === user.id) {
        queueRef.current = queueRef.current.slice(1);
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

      setJob({
        kind: "working",
        completed,
        total: Math.max(totalAtStart, completed + queueRef.current.length),
        handle: displayHandle(target.handle),
      });

      const result = await postUnfollow(target.accountId, user.id);
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

      queueRef.current = queueRef.current.slice(1);
      completed += 1;

      if (result.ok) {
        setRows((current) => current.filter((row) => row.accountId !== target.accountId));
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(target.accountId);
          return next;
        });
      } else {
        failures.push(`${displayHandle(target.handle)}: ${result.error}`);
        setActionError(failures.join("\n"));
      }
    }

    runningRef.current = false;
    if (abortRef.current && pausedRef.current && queueRef.current.length > 0) {
      setJob({
        kind: "paused",
        remaining: queueRef.current.length,
        completed,
        total: completed + queueRef.current.length,
      });
      return;
    }
    if (abortRef.current) {
      setJob({ kind: "idle" });
      return;
    }
    setJob({ kind: "idle" });
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
    queueRef.current = [...queueRef.current, ...added];
    setConfirm({ open: false });
    setActionError(null);
    if (!runningRef.current && !pausedRef.current) void runQueue();
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

  function stopQueue() {
    pausedRef.current = false;
    abortRef.current = true;
    queueRef.current = [];
    setJob({ kind: "idle" });
  }

  const busy = job.kind === "waiting" || job.kind === "working";
  const confirmCount = confirm.open
    ? confirm.mode === "one"
      ? 1
      : confirm.rows.length
    : 0;
  const confirmLabel =
    confirm.open && confirm.mode === "one"
      ? displayHandle(confirm.row.handle)
      : `${confirmCount} selected`;

  const queueStatus = (() => {
    switch (job.kind) {
      case "idle":
        return null;
      case "paused":
        return `Paused · ${job.completed} done · ${job.remaining} left in queue`;
      case "waiting": {
        const remainingMs = Math.max(0, job.until - now);
        const why =
          job.reason === "rate-limit"
            ? "X rate limit"
            : `random ${formatGapRange()} gap`;
        return `Waiting ${formatWait(remainingMs)} (${why}) then ${job.handle} · ${job.completed}/${job.total}`;
      }
      case "working":
        return `Unfollowing ${job.handle} · ${job.completed + 1}/${job.total}`;
      default: {
        const exhaustive: never = job;
        return exhaustive;
      }
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-b px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">X Follow Manager</h1>
              <p className="text-sm text-muted-foreground">
                CSV stays in this browser · unfollow via the X API as {displayHandle(user.username)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{displayHandle(user.username)}</Badge>
              <span className="text-xs text-muted-foreground">id {user.id}</span>
              <Button type="button" variant="outline" size="sm" onClick={onLogout}>
                Logout
              </Button>
            </div>
          </div>
        </header>

        <section className="flex flex-col gap-3 border-b px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="csv-file">Follows CSV</Label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={handleFileChange}
                />
                <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  Choose CSV
                </Button>
                <Button type="button" variant="ghost" onClick={loadSample}>
                  Load sample
                </Button>
                {fileName ? (
                  <span className="text-sm text-muted-foreground">
                    {fileName}
                    {rows.length > 0 ? ` · ${rows.length} loaded` : null}
                    {skipped > 0 ? ` · ${skipped} skipped` : null}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">Nothing loaded yet</span>
                )}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cutoff">Cutoff (local)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="cutoff"
                  type="datetime-local"
                  min={CUTOFF_MIN_LOCAL}
                  max={CUTOFF_MAX_LOCAL}
                  step={60}
                  value={cutoff}
                  onChange={(event) => setCutoff(clampCutoffLocal(event.target.value))}
                  className="w-[17.5rem]"
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setCutoff(daysAgoLocal(30))}>
                  30 days
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCutoff(daysAgoLocal(90))}>
                  90 days
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCutoff(daysAgoLocal(365))}>
                  1 year
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCutoff(toDatetimeLocalValue(new Date()))}
                >
                  Now
                </Button>
              </div>
              {cutoffDate ? (
                <p className="text-xs text-muted-foreground">
                  Filtering before {formatCutoffLocal(cutoff)} local.
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing accounts whose last post is before the cutoff, or who have never posted / unknown last
            post. Changing the cutoff unchecks everyone. X allows {UNFOLLOW_LIMIT_PER_WINDOW} unfollows per
            15 minutes per user; the queue waits a random {formatGapRange()} between calls so it stays well
            under that.
          </p>
        </section>

        {loadError ? (
          <div className="px-4 pt-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load CSV</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        {actionError ? (
          <div className="px-4 pt-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Unfollow did not succeed</AlertTitle>
              <AlertDescription>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{actionError}</pre>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkAllFiltered}
            disabled={selectableFiltered.length === 0 || busy}
          >
            Check all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={uncheckAllFiltered}
            disabled={selectedFiltered.length === 0 || busy}
          >
            Uncheck all
          </Button>
          <span className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Load a CSV to begin"
              : `${filtered.length} of ${rows.length} match · ${selectedFiltered.length} selected · ${whitelistedFilteredCount} whitelisted`}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {queueStatus ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {job.kind === "working" ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
                {queueStatus}
              </span>
            ) : null}
            {job.kind === "paused" ? (
              <Button type="button" variant="outline" size="sm" onClick={resumeQueue}>
                Resume queue
              </Button>
            ) : null}
            {busy ? (
              <Button type="button" variant="outline" size="sm" onClick={pauseQueue}>
                Pause
              </Button>
            ) : null}
            {job.kind !== "idle" ? (
              <Button type="button" variant="ghost" size="sm" onClick={stopQueue}>
                Stop queue
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectedFiltered.length === 0}
              onClick={() => whitelistAccounts(selectedFiltered)}
            >
              Whitelist all (selected)
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedFiltered.length === 0}
              onClick={() => setConfirm({ open: true, mode: "selected", rows: selectedFiltered })}
            >
              Unfollow all (selected)
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted-foreground">
              Choose a CSV from disk (or load the sample). The file is parsed here with FileReader and is
              not sent to the server.
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted-foreground">
              No accounts match this cutoff. Everyone in the list posted on or after{" "}
              {cutoffDate ? cutoffDate.toLocaleString("en-AU") : "the cutoff"}.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelectableChecked}
                      onCheckedChange={(checked) => {
                        if (checked) checkAllFiltered();
                        else uncheckAllFiltered();
                      }}
                      aria-label="Check all filtered"
                      disabled={busy || selectableFiltered.length === 0}
                    />
                  </TableHead>
                  <TableHead>Handle</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Last post</TableHead>
                  <TableHead>Profile</TableHead>
                  <TableHead className="text-right"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const listed = whitelisted.has(row.accountId);
                  const checked = !listed && selectedIds.has(row.accountId);
                  const url = profileUrl(row);
                  return (
                    <TableRow
                      key={row.accountId}
                      data-state={checked ? "selected" : undefined}
                      className={listed ? "opacity-70" : undefined}
                    >
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleOne(row.accountId, Boolean(value))}
                          aria-label={`Select ${displayHandle(row.handle)}`}
                          disabled={busy || listed}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{displayHandle(row.handle)}</TableCell>
                      <TableCell>
                        <span className="mr-2">{row.name || "—"}</span>
                        {row.status ? (
                          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                        ) : null}
                        {listed ? (
                          <Badge variant="outline" className="ml-1">
                            whitelisted
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{formatLastPost(row.lastPostAt)}</TableCell>
                      <TableCell>
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block max-w-[14rem] truncate text-xs text-muted-foreground underline-offset-4 hover:underline"
                        >
                          {url}
                        </a>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {listed ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => removeWhitelist(row.accountId)}
                            >
                              Remove from whitelist
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => whitelistAccounts([row])}
                            >
                              Whitelist
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="destructive"
                            size="xs"
                            disabled={listed}
                            onClick={() => setConfirm({ open: true, mode: "one", row })}
                          >
                            Unfollow
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog
        open={confirm.open}
        onOpenChange={(open) => {
          if (!open) setConfirm({ open: false });
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirm.open && confirm.mode === "selected"
                ? `Queue ${confirmCount} selected ${confirmCount === 1 ? "unfollow" : "unfollows"}?`
                : `Queue unfollow for ${confirmLabel}?`}
            </DialogTitle>
            <DialogDescription>
              X limits unfollows to {UNFOLLOW_LIMIT_PER_WINDOW} per 15 minutes per user. This adds{" "}
              {confirmCount} {confirmCount === 1 ? "account" : "accounts"} to a client-side queue that
              waits a random {formatGapRange()} between calls (and longer if X returns 429). It cannot be
              undone from this tool.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm({ open: false })}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => enqueueUnfollows(confirmTargets(confirm))}
            >
              Add to queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
