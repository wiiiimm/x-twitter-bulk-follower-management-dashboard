"use client";

import { useState, type FormEvent } from "react";
import { AlertCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function LoginScreen({
  error,
  busy,
  onSubmit,
}: {
  error: string | null;
  busy: boolean;
  onSubmit: (token: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = draft.trim();
    if (!token) return;
    onSubmit(token);
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          X/Twitter Bulk Follower Management Dashboard
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste a user OAuth 2.0 access token to manage who you follow. The token stays in this
          browser (local storage). It is never written to disk on the server.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Could not sign in</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <form className="grid gap-3" onSubmit={handleSubmit}>
        <Label htmlFor="access-token">X API user access token</Label>
        <Textarea
          id="access-token"
          name="access-token"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          rows={5}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="User token with follows.write, tweet.read, users.read"
        />
        <p className="text-xs text-muted-foreground">
          Not an app-only bearer token. Scopes: follows.write, tweet.read, users.read.
        </p>
        <Button type="submit" disabled={busy || draft.trim().length === 0}>
          {busy ? "Checking token…" : "Continue"}
        </Button>
      </form>
    </main>
  );
}
