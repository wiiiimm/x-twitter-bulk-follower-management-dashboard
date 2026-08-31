"use client";

import { LoaderCircleIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { displayHandle, type FollowRow } from "@/lib/follows";
import { cn } from "@/lib/utils";

export type QueueRunState = "idle" | "waiting" | "working" | "paused";

export function UnfollowQueuePanel({
  items,
  runState,
  statusText,
  lockedAccountId,
  sessionUnfollowed,
  className,
  onPause,
  onPlay,
  onClear,
  onRemove,
}: {
  items: FollowRow[];
  runState: QueueRunState;
  statusText: string | null;
  lockedAccountId: string | null;
  sessionUnfollowed: number;
  className?: string;
  onPause: () => void;
  onPlay: () => void;
  onClear: () => void;
  onRemove: (accountId: string) => void;
}) {
  const running = runState === "waiting" || runState === "working";
  const empty = items.length === 0;
  const label =
    sessionUnfollowed === 1 ? "account unfollowed" : "accounts unfollowed";

  return (
    <aside
      className={cn(
        "flex h-[min(42vh,24rem)] min-h-0 w-full shrink-0 flex-col overflow-hidden border-t bg-background lg:h-auto lg:w-80 lg:min-w-80 lg:self-stretch lg:border-t-0 lg:border-l",
        className,
      )}
    >
      <div className="shrink-0 border-b bg-foreground px-4 py-5 text-background">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-background/65">
          This session
        </p>
        <p className="mt-2 font-mono text-5xl font-semibold tabular-nums leading-none tracking-tight">
          {sessionUnfollowed}
        </p>
        <p className="mt-2 text-sm text-background/80">{label}</p>
        <p className="mt-3 text-xs text-background/55">
          {empty ? "Queue is empty" : `${items.length} waiting in queue`}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2.5">
        <h2 className="min-w-0 flex-1 text-sm font-medium">Unfollow queue</h2>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          disabled={empty || running}
          aria-label="Play queue"
          onClick={onPlay}
        >
          <PlayIcon />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          disabled={empty || !running}
          aria-label="Pause queue"
          onClick={onPause}
        >
          <PauseIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={empty}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>

      {statusText ? (
        <p className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
          {runState === "working" ? (
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
          ) : null}
          {statusText}
        </p>
      ) : null}

      <ScrollArea className="h-0 min-h-0 flex-1">
        {empty ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">
            Add accounts with Unfollow or Unfollow all, then press play.
          </p>
        ) : (
          <ol className="flex flex-col">
            {items.map((row, index) => {
              const locked = row.accountId === lockedAccountId;
              const current = index === 0 && running;
              return (
                <li
                  key={row.accountId}
                  className={cn(
                    "flex items-start gap-2 border-b px-3 py-2 last:border-b-0",
                    current ? "bg-muted/60" : null,
                  )}
                >
                  <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayHandle(row.handle)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.name || row.accountId}
                    </p>
                    {current ? (
                      <Badge variant="secondary" className="mt-1">
                        {runState === "working" ? "Unfollowing" : "Next"}
                      </Badge>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={locked}
                    aria-label={`Remove ${displayHandle(row.handle)} from queue`}
                    onClick={() => onRemove(row.accountId)}
                  >
                    <XIcon />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </ScrollArea>
    </aside>
  );
}
