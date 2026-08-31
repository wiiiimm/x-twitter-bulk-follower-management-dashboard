"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { AlertCircleIcon } from "lucide-react";

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
import { ActivityYearChart } from "@/components/activity-year-chart";
import { UnfollowQueuePanel } from "@/components/unfollow-queue-panel";
import { useUnfollowQueue } from "@/hooks/use-unfollow-queue";
import { cutoffAfterYearLocal } from "@/lib/activity-by-year";
import { parseFollowsCsv } from "@/lib/csv";
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
  formatGapRange,
  formatWait,
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

export function PruneApp({
  user,
  onLogout,
}: {
  user: SignedInUser;
  onLogout: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipCutoffUncheck = useRef(true);
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
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });
  const [now, setNow] = useState(() => Date.now());

  const {
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
  } = useUnfollowQueue({
    user,
    whitelisted,
    setRows,
    setSelectedIds,
    setActionError,
  });

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

  const queuedIds = useMemo(
    () => new Set(queuedRows.map((row) => row.accountId)),
    [queuedRows],
  );

  const selectedForUnfollow = useMemo(
    () => selectedFiltered.filter((row) => !queuedIds.has(row.accountId)),
    [selectedFiltered, queuedIds],
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
    dropQueuedIds(ids);
  }

  function removeWhitelist(accountId: string) {
    removeFromWhitelist(accountId);
  }

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
        return queuedRows.length > 0 ? `${queuedRows.length} in queue · press play` : null;
      case "paused":
        return queuedRows.length > 0
          ? `Paused · ${queuedRows.length} waiting · press play`
          : null;
      case "waiting": {
        const remainingMs = Math.max(0, job.until - now);
        const why =
          job.reason === "rate-limit"
            ? "X rate limit"
            : `random ${formatGapRange()} gap`;
        return `Waiting ${formatWait(remainingMs)} (${why}) then ${job.handle}`;
      }
      case "working":
        return `Unfollowing ${job.handle}`;
      default: {
        const exhaustive: never = job;
        return exhaustive;
      }
    }
  })();

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[12rem] shrink-0">
              <h1 className="text-lg font-semibold tracking-tight">X Follow Manager</h1>
              <p className="text-sm text-muted-foreground">
                CSV stays in this browser · unfollow via the X API as {displayHandle(user.username)}
              </p>
            </div>
            <ActivityYearChart
              className="min-w-[16rem] flex-1"
              rows={rows}
              cutoff={cutoffDate}
              onSelectYear={(year) => setCutoff(clampCutoffLocal(cutoffAfterYearLocal(year)))}
            />
            <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
              <Badge variant="outline">{displayHandle(user.username)}</Badge>
              <span className="text-xs text-muted-foreground">id {user.id}</span>
              <Button type="button" variant="outline" size="sm" onClick={onLogout}>
                Logout
              </Button>
            </div>
          </div>
        </header>

        <section className="flex shrink-0 flex-col gap-3 border-b px-4 py-3">
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
            post. Changing the cutoff unchecks everyone; you can still filter and add more accounts while
            the queue runs. X allows {UNFOLLOW_LIMIT_PER_WINDOW} unfollows per 15 minutes per user; the
            queue waits a random {formatGapRange()} between calls so it stays well under that.
          </p>
        </section>

        {loadError ? (
          <div className="shrink-0 px-4 pt-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Could not load CSV</AlertTitle>
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        {actionError ? (
          <div className="shrink-0 px-4 pt-3">
            <Alert variant="destructive">
              <AlertCircleIcon />
              <AlertTitle>Unfollow did not succeed</AlertTitle>
              <AlertDescription>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{actionError}</pre>
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkAllFiltered}
            disabled={selectableFiltered.length === 0}
          >
            Check all
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={uncheckAllFiltered}
            disabled={selectedFiltered.length === 0}
          >
            Uncheck all
          </Button>
          <span className="text-sm text-muted-foreground">
            {rows.length === 0
              ? "Load a CSV to begin"
              : `${filtered.length} of ${rows.length} match · ${selectedFiltered.length} selected · ${whitelistedFilteredCount} whitelisted`}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
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
              disabled={selectedForUnfollow.length === 0}
              onClick={() =>
                setConfirm({ open: true, mode: "selected", rows: selectedForUnfollow })
              }
            >
              Unfollow all (selected)
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
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
                      disabled={selectableFiltered.length === 0}
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
                  const queued = queuedIds.has(row.accountId);
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
                          disabled={listed}
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
                        {queued ? (
                          <Badge variant="secondary" className="ml-1">
                            queued
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
                            disabled={listed || queued}
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
          <UnfollowQueuePanel
            items={queuedRows}
            runState={job.kind}
            statusText={queueStatus}
            lockedAccountId={inFlightId}
            sessionUnfollowed={sessionUnfollowed}
            onPause={pauseQueue}
            onPlay={resumeQueue}
            onClear={clearQueue}
            onRemove={removeQueued}
          />
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
              {confirmCount} {confirmCount === 1 ? "account" : "accounts"} to the queue on the right.
              You can keep filtering and add more, or remove people before they are unfollowed. The
              queue waits a random {formatGapRange()} between calls (and longer if X returns 429). A
              completed unfollow cannot be undone from this tool.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm({ open: false })}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                enqueueUnfollows(confirmTargets(confirm));
                setConfirm({ open: false });
              }}
            >
              Add to queue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
