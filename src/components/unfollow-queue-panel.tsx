"use client";

import { LoaderCircleIcon, XIcon } from "lucide-react";

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
  completed,
  total,
  className,
  onPause,
  onResume,
  onStop,
  onRemove,
}: {
  items: FollowRow[];
  runState: QueueRunState;
  statusText: string | null;
  lockedAccountId: string | null;
  completed: number;
  total: number;
  className?: string;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRemove: (accountId: string) => void;
}) {
  const running = runState === "waiting" || runState === "working";

  return (
    <aside
      className={cn(
        "flex min-h-0 w-full shrink-0 flex-col border-t bg-background lg:w-80 lg:self-stretch lg:border-t-0 lg:border-l",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Unfollow queue</h2>
          <p className="text-xs text-muted-foreground">
            {completed}/{total} done · {items.length} waiting
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {runState === "paused" ? (
            <Button type="button" variant="outline" size="xs" onClick={onResume}>
              Resume
            </Button>
          ) : null}
          {running ? (
            <Button type="button" variant="outline" size="xs" onClick={onPause}>
              Pause
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="xs" onClick={onStop}>
            Stop
          </Button>
        </div>
      </div>
      {statusText ? (
        <p className="flex items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
          {runState === "working" ? (
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
          ) : null}
          {statusText}
        </p>
      ) : null}
      <ScrollArea className="min-h-0 flex-1">
        {items.length === 0 ? (
          <p className="px-3 py-6 text-xs text-muted-foreground">Queue is empty.</p>
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
                    <p className="truncate text-xs text-muted-foreground">{row.name || row.accountId}</p>
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
