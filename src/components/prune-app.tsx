"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { AlertCircleIcon, LoaderCircleIcon } from "lucide-react";

import { ProfilePanel, type ProfilePreview } from "@/components/profile-panel";
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

export type SignedInUser = {
  id: string;
  username: string;
  name: string;
};

type UnfollowJob =
  | { kind: "idle" }
  | { kind: "running"; current: number; total: number; handle: string };

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

async function postUnfollow(targetUserId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = readAccessToken();
  if (!token) {
    return { ok: false, error: "Not signed in. Paste a user token on the login screen." };
  }
  const response = await fetch("/api/unfollow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ targetUserId }),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Unfollow failed (${response.status}).`;
    return { ok: false, error };
  }
  return { ok: true };
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
  const [rows, setRows] = useState<FollowRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [cutoff, setCutoff] = useState(() => daysAgoLocal(90));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [job, setJob] = useState<UnfollowJob>({ kind: "idle" });
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false });

  useEffect(() => {
    if (skipCutoffUncheck.current) {
      skipCutoffUncheck.current = false;
      return;
    }
    setSelectedIds(new Set());
  }, [cutoff]);

  const cutoffDate = useMemo(() => parseCutoff(cutoff), [cutoff]);

  const filtered = useMemo(
    () => rows.filter((row) => isBeforeCutoff(row, cutoffDate)),
    [rows, cutoffDate],
  );

  const selectedFiltered = useMemo(
    () => filtered.filter((row) => selectedIds.has(row.accountId)),
    [filtered, selectedIds],
  );

  const allFilteredChecked =
    filtered.length > 0 && filtered.every((row) => selectedIds.has(row.accountId));

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
    setPreview(null);
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
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  }

  function checkAllFiltered() {
    setSelectedIds(new Set(filtered.map((row) => row.accountId)));
  }

  function uncheckAllFiltered() {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of filtered) next.delete(row.accountId);
      return next;
    });
  }

  function openProfile(row: FollowRow, event?: MouseEvent) {
    event?.preventDefault();
    const url = profileUrl(row);
    let reservedWindow: Window | null = null;
    try {
      reservedWindow = window.open("about:blank", "x-profile-preview");
    } catch {
      reservedWindow = null;
    }
    setPreview({ handle: row.handle, url, reservedWindow });
  }

  async function runUnfollows(targets: FollowRow[]) {
    setConfirm({ open: false });
    setActionError(null);
    const failures: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      setJob({
        kind: "running",
        current: i + 1,
        total: targets.length,
        handle: displayHandle(target.handle),
      });
      const result = await postUnfollow(target.accountId);
      if (result.ok) {
        setRows((current) => current.filter((row) => row.accountId !== target.accountId));
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(target.accountId);
          return next;
        });
        setPreview((current) => {
          if (!current) return current;
          return current.url === profileUrl(target) ? null : current;
        });
      } else {
        failures.push(`${displayHandle(target.handle)}: ${result.error}`);
      }
      if (i < targets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    setJob({ kind: "idle" });
    if (failures.length > 0) {
      setActionError(failures.join("\n"));
    }
  }

  const busy = job.kind === "running";
  const confirmCount = confirm.open
    ? confirm.mode === "one"
      ? 1
      : confirm.rows.length
    : 0;
  const confirmLabel =
    confirm.open && confirm.mode === "one"
      ? displayHandle(confirm.row.handle)
      : `${confirmCount} selected`;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="border-b px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                X/Twitter Bulk Follower Management Dashboard
              </h1>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCutoff(daysAgoLocal(30))}
                >
                  30 days
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCutoff(daysAgoLocal(90))}
                >
                  90 days
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCutoff(daysAgoLocal(365))}
                >
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
            Showing accounts whose last post is before the cutoff, or who have never posted / unknown last post.
            Changing the cutoff unchecks everyone.
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
          <Button type="button" variant="outline" size="sm" onClick={checkAllFiltered} disabled={filtered.length === 0 || busy}>
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
              : `${filtered.length} of ${rows.length} match · ${selectedFiltered.length} selected`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {job.kind === "running" ? (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Unfollowing {job.current} of {job.total}: {job.handle}
              </span>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={selectedFiltered.length === 0 || busy}
              onClick={() => setConfirm({ open: true, mode: "selected", rows: selectedFiltered })}
            >
              Unfollow all (selected)
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <div className="px-4 py-10 text-sm text-muted-foreground">
              Choose a CSV from disk (or load the sample). The file is parsed here with FileReader and is not sent to
              the server.
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
                      checked={allFilteredChecked}
                      onCheckedChange={(checked) => {
                        if (checked) checkAllFiltered();
                        else uncheckAllFiltered();
                      }}
                      aria-label="Check all filtered"
                      disabled={busy}
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
                  const checked = selectedIds.has(row.accountId);
                  const url = profileUrl(row);
                  return (
                    <TableRow
                      key={row.accountId}
                      data-state={checked ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={(event) => openProfile(row, event)}
                    >
                      <TableCell
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleOne(row.accountId, Boolean(value))}
                          aria-label={`Select ${displayHandle(row.handle)}`}
                          disabled={busy}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <button
                          type="button"
                          className="text-left hover:underline"
                          onClick={(event) => openProfile(row, event)}
                        >
                          {displayHandle(row.handle)}
                        </button>
                      </TableCell>
                      <TableCell>
                        <span className="mr-2">{row.name || "—"}</span>
                        {row.status ? (
                          <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{formatLastPost(row.lastPostAt)}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className="max-w-[14rem] truncate text-left text-xs text-muted-foreground hover:underline"
                          onClick={(event) => openProfile(row, event)}
                        >
                          {url}
                        </button>
                      </TableCell>
                      <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          disabled={busy}
                          onClick={() => setConfirm({ open: true, mode: "one", row })}
                        >
                          Unfollow
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {preview ? <ProfilePanel key={preview.url} preview={preview} onClose={() => setPreview(null)} /> : null}

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
                ? `Unfollow ${confirmCount} selected ${confirmCount === 1 ? "account" : "accounts"}?`
                : `Unfollow ${confirmLabel}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm.open && confirm.mode === "selected"
                ? `This will call DELETE on the X API for ${confirmCount} selected account${confirmCount === 1 ? "" : "s"} as ${displayHandle(user.username)} (${user.id}). It cannot be undone from this tool.`
                : `This will call DELETE on the X API as ${displayHandle(user.username)}. It cannot be undone from this tool.`}
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
                void runUnfollows(confirmTargets(confirm));
              }}
            >
              Unfollow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
