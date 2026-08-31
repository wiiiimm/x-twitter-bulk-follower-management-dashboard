"use client";

import { useEffect, useState } from "react";

import { LoginScreen } from "@/components/login-screen";
import { PruneApp, type SignedInUser } from "@/components/prune-app";
import { clearUserSession, readAccessToken, writeStoredTokens } from "@/lib/browser-token";
import { consumeOAuthRedirectError } from "@/lib/oauth";
import { refreshUserAccessToken } from "@/lib/oauth-client";

type AuthState =
  | { kind: "loading" }
  | { kind: "anonymous"; error: string | null }
  | { kind: "authenticated"; user: SignedInUser };

function parseUserPayload(payload: unknown): SignedInUser | null {
  if (!payload || typeof payload !== "object") return null;
  const user =
    "user" in payload && payload.user && typeof payload.user === "object"
      ? (payload.user as { id?: unknown; username?: unknown; name?: unknown })
      : null;
  if (!user) return null;
  if (typeof user.id !== "string" || typeof user.username !== "string") return null;
  return {
    id: user.id,
    username: user.username,
    name: typeof user.name === "string" ? user.name : "",
  };
}

function errorFromPayload(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error.trim();
  }
  return fallback;
}

async function resolveUser(token: string): Promise<
  { ok: true; user: SignedInUser } | { ok: false; error: string; status: number }
> {
  const response = await fetch("/api/me", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: errorFromPayload(payload, `Could not resolve the signed-in user (${response.status}).`),
    };
  }
  const user = parseUserPayload(payload);
  if (!user) {
    return { ok: false, status: 502, error: "X API returned an unexpected user payload." };
  }
  return { ok: true, user };
}

async function resolveUserWithRefresh(token: string): Promise<
  { ok: true; user: SignedInUser } | { ok: false; error: string }
> {
  const first = await resolveUser(token);
  if (first.ok) return first;
  if (first.status !== 401) return { ok: false, error: first.error };
  const refreshed = await refreshUserAccessToken();
  if (!refreshed) return { ok: false, error: first.error };
  const second = await resolveUser(refreshed);
  if (second.ok) return second;
  return { ok: false, error: second.error };
}

export function AppShell() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      await Promise.resolve();
      const redirectError = consumeOAuthRedirectError();
      const stored = readAccessToken();
      if (!stored) {
        if (!cancelled) setAuth({ kind: "anonymous", error: redirectError });
        return;
      }
      const result = await resolveUserWithRefresh(stored);
      if (cancelled) return;
      if (!result.ok) {
        clearUserSession();
        setAuth({ kind: "anonymous", error: redirectError ?? result.error });
        return;
      }
      setAuth({ kind: "authenticated", user: result.user });
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(token: string) {
    setBusy(true);
    const result = await resolveUser(token);
    setBusy(false);
    if (!result.ok) {
      clearUserSession();
      setAuth({ kind: "anonymous", error: result.error });
      return;
    }
    writeStoredTokens({ accessToken: token, refreshToken: null, expiresAt: null });
    setAuth({ kind: "authenticated", user: result.user });
  }

  function handleLogout() {
    clearUserSession();
    setAuth({ kind: "anonymous", error: null });
  }

  switch (auth.kind) {
    case "loading":
      return (
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 text-sm text-muted-foreground">
          Checking saved session…
        </main>
      );
    case "anonymous":
      return <LoginScreen error={auth.error} busy={busy} onSubmit={(token) => void handleLogin(token)} />;
    case "authenticated":
      return (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PruneApp user={auth.user} onLogout={handleLogout} />
        </main>
      );
    default: {
      const exhaustive: never = auth;
      return exhaustive;
    }
  }
}
