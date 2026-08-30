"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLinkIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { displayHandle } from "@/lib/follows";

export type ProfilePreview = {
  handle: string;
  url: string;
  reservedWindow: Window | null;
};

type FrameState = "loading" | "blocked" | "framed";

type FrameProbe = "blocked" | "framed" | "pending";

function probeIframe(iframe: HTMLIFrameElement): FrameProbe {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return "blocked";
    const href = doc.location?.href ?? "";
    if (!href || href === "about:blank" || href.startsWith("about:")) return "pending";
    return "blocked";
  } catch {
    return "framed";
  }
}

export function ProfilePanel({
  preview,
  onClose,
}: {
  preview: ProfilePreview;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reservedWindowRef = useRef<Window | null>(preview.reservedWindow);
  const [frameState, setFrameState] = useState<FrameState>("loading");

  useEffect(() => {
    reservedWindowRef.current = preview.reservedWindow;

    const timeoutId = window.setTimeout(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;
      const probe = probeIframe(iframe);
      if (probe === "framed") {
        setFrameState("framed");
        const reserved = reservedWindowRef.current;
        if (reserved && !reserved.closed) reserved.close();
        return;
      }
      setFrameState((current) => {
        if (current === "framed") return current;
        const reserved = reservedWindowRef.current;
        if (reserved && !reserved.closed) {
          try {
            reserved.location.replace(preview.url);
          } catch {
            window.open(preview.url, "x-profile-preview");
          }
        } else {
          window.open(preview.url, "x-profile-preview");
        }
        return "blocked";
      });
    }, 1200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [preview.url, preview.reservedWindow]);

  function navigateReserved(url: string) {
    const reserved = reservedWindowRef.current;
    if (reserved && !reserved.closed) {
      try {
        reserved.location.replace(url);
        return;
      } catch {
        // Fall through to a named window.
      }
    }
    window.open(url, "x-profile-preview");
  }

  function fallBackToWindow(url: string) {
    setFrameState((current) => {
      if (current === "framed") return current;
      navigateReserved(url);
      return "blocked";
    });
  }

  function handleIframeLoad() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const probe = probeIframe(iframe);
    if (probe === "pending") return;
    if (probe === "framed") {
      setFrameState("framed");
      const reserved = reservedWindowRef.current;
      if (reserved && !reserved.closed) reserved.close();
      return;
    }
    fallBackToWindow(preview.url);
  }

  function openInNewTab() {
    navigateReserved(preview.url);
    setFrameState("blocked");
  }

  const showIframe = frameState !== "blocked";

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-t bg-background md:w-[min(28rem,40vw)] md:border-t-0 md:border-l">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{displayHandle(preview.handle)}</p>
          <p className="truncate text-xs text-muted-foreground">{preview.url}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={openInNewTab}>
          <ExternalLinkIcon />
          New tab
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close profile">
          <XIcon />
        </Button>
      </div>
      {showIframe ? (
        <iframe
          key={preview.url}
          ref={iframeRef}
          title={`Profile ${displayHandle(preview.handle)}`}
          src={preview.url}
          className="min-h-[50vh] flex-1 bg-muted md:min-h-0"
          onLoad={handleIframeLoad}
        />
      ) : null}
      {frameState === "blocked" ? (
        <div className="flex flex-1 flex-col justify-center gap-3 p-4 text-sm">
          <p className="font-medium">X refused the iframe</p>
          <p className="text-muted-foreground">
            x.com sends <code className="font-mono text-xs">X-Frame-Options: SAMEORIGIN</code> and a matching CSP{" "}
            <code className="font-mono text-xs">frame-ancestors</code> rule, so the profile cannot load here. It was
            opened in a separate tab instead.
          </p>
          <Button type="button" onClick={openInNewTab}>
            <ExternalLinkIcon />
            Open {displayHandle(preview.handle)}
          </Button>
        </div>
      ) : null}
      {frameState === "loading" ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Trying iframe… if X blocks it, a new tab opens.</p>
      ) : null}
    </aside>
  );
}
