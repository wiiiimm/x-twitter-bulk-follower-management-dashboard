"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { AlertCircleIcon, CheckIcon, CopyIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  clearAppCredentials,
  getAppCredentialsSnapshot,
  getServerAppCredentialsSnapshot,
  hasOAuth2Client,
  subscribeAppCredentials,
  writeAppCredentials,
  type AppCredentials,
} from "@/lib/browser-token";
import {
  buildXAuthorizeUrl,
  oauthCallbackUrl,
  randomBase64Url,
  sha256Base64Url,
  websiteUrl,
  writePkceSession,
} from "@/lib/oauth";

function subscribeWindowOrigin() {
  return () => {};
}

function getWindowOrigin() {
  return window.location.origin;
}

function getServerOrigin() {
  return "";
}

export function LoginScreen({
  error,
  busy,
  onSubmit,
}: {
  error: string | null;
  busy: boolean;
  onSubmit: (token: string) => void;
}) {
  const draft = useSyncExternalStore(
    subscribeAppCredentials,
    getAppCredentialsSnapshot,
    getServerAppCredentialsSnapshot,
  );
  const origin = useSyncExternalStore(subscribeWindowOrigin, getWindowOrigin, getServerOrigin);
  const [tokenDraft, setTokenDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [copied, setCopied] = useState<"callback" | "website" | null>(null);

  const callback = origin ? oauthCallbackUrl(origin) : "";
  const site = origin ? websiteUrl(origin) : "";
  const canStartOauth = hasOAuth2Client(draft);
  const displayError = localError ?? error;

  async function copyValue(kind: "callback" | "website", value: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt("Copy this URL into the X developer portal", value);
    }
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1500);
  }

  function persistDraft(next: AppCredentials) {
    writeAppCredentials(next);
  }

  async function startOauthLogin() {
    setLocalError(null);
    const credentials: AppCredentials = {
      apiKey: draft.apiKey,
      apiSecret: draft.apiSecret,
      clientId: draft.clientId.trim(),
      clientSecret: draft.clientSecret.trim(),
    };
    if (!hasOAuth2Client(credentials)) {
      setLocalError("OAuth 2.0 Client ID and Client Secret are required to generate an access token.");
      return;
    }
    if (!window.isSecureContext || !crypto.subtle) {
      setLocalError("This browser cannot run PKCE (needs HTTPS or localhost).");
      return;
    }
    writeAppCredentials(credentials);
    setOauthBusy(true);
    try {
      const redirectUri = oauthCallbackUrl(window.location.origin);
      const state = randomBase64Url(16);
      const verifier = randomBase64Url(32);
      const codeChallenge = await sha256Base64Url(verifier);
      writePkceSession({
        state,
        verifier,
        redirectUri,
        clientId: credentials.clientId,
      });
      window.location.assign(
        buildXAuthorizeUrl({
          clientId: credentials.clientId,
          redirectUri,
          state,
          codeChallenge,
        }),
      );
    } catch (caught) {
      setOauthBusy(false);
      setLocalError(
        caught instanceof Error ? caught.message : "Could not start generating an access token.",
      );
    }
  }

  function handleTokenSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenDraft.trim();
    if (!token) return;
    setLocalError(null);
    onSubmit(token);
  }

  function handleClearKeys() {
    clearAppCredentials();
    setLocalError(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">X Follow Manager</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste your OAuth 2.0 Client ID and Client Secret, add this site as a callback, then generate a
          new user access token. Credentials stay in this browser. They are never written to disk on the
          server.
        </p>
      </div>

      {displayError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Could not sign in</AlertTitle>
          <AlertDescription>{displayError}</AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 rounded-xl border p-4">
        <div>
          <h2 className="text-sm font-medium">1. OAuth 2.0 Client ID and Client Secret</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            In the X developer portal, open your app → User authentication settings. Enable OAuth 2.0
            (Authorization Code with PKCE), app type Web App, then copy Client ID and Client Secret. Not
            the API Key, API Secret, or app-only bearer token.
          </p>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="client-id">Client ID</Label>
            <Input
              id="client-id"
              name="client-id"
              autoComplete="off"
              spellCheck={false}
              value={draft.clientId}
              disabled={oauthBusy || busy}
              onChange={(event) => persistDraft({ ...draft, clientId: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="client-secret">Client Secret</Label>
            <Input
              id="client-secret"
              name="client-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft.clientSecret}
              disabled={oauthBusy || busy}
              onChange={(event) => persistDraft({ ...draft, clientSecret: event.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-xl border p-4">
        <div>
          <h2 className="text-sm font-medium">2. Callback URLs in the portal</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Add these exact URLs under User authentication settings, then generate a token. Scopes
            requested: tweet.read, users.read, follows.write, offline.access.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="website-url">Website URL</Label>
          <div className="flex gap-2">
            <Input id="website-url" readOnly value={site || "Loading…"} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!site}
              aria-label="Copy website URL"
              onClick={() => void copyValue("website", site)}
            >
              {copied === "website" ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="callback-url">Callback URL / Redirect URI</Label>
          <div className="flex gap-2">
            <Input id="callback-url" readOnly value={callback || "Loading…"} />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={!callback}
              aria-label="Copy callback URL"
              onClick={() => void copyValue("callback", callback)}
            >
              {copied === "callback" ? <CheckIcon /> : <CopyIcon />}
            </Button>
          </div>
        </div>
        <Button
          type="button"
          disabled={!canStartOauth || oauthBusy || busy}
          onClick={() => void startOauthLogin()}
        >
          {oauthBusy ? "Redirecting to X…" : "Generate access token"}
        </Button>
        {!canStartOauth ? (
          <p className="text-xs text-muted-foreground">
            Client ID and Client Secret are required. Generate access token opens X so you can authorise
            this app; the new user token is stored in this browser.
          </p>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={handleClearKeys}>
          Clear saved Client ID and Secret
        </Button>
      </section>

      <Separator />

      <details className="rounded-xl border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">
          Already have a user OAuth 2.0 access token?
        </summary>
        <form className="mt-3 grid gap-3" onSubmit={handleTokenSubmit}>
          <Label htmlFor="access-token">User access token</Label>
          <Textarea
            id="access-token"
            name="access-token"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            rows={4}
            value={tokenDraft}
            disabled={busy || oauthBusy}
            onChange={(event) => setTokenDraft(event.target.value)}
            placeholder="Token with follows.write, tweet.read, users.read"
          />
          <p className="text-xs text-muted-foreground">
            Not an app-only bearer, and not OAuth 1.0a keys from Keys and tokens. Generate access token
            above if you do not have one.
          </p>
          <Button type="submit" variant="outline" disabled={busy || tokenDraft.trim().length === 0}>
            {busy ? "Checking token…" : "Continue with pasted token"}
          </Button>
        </form>
      </details>
    </main>
  );
}
