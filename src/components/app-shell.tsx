"use client";

import { useEffect, useState } from "react";

import { LoginScreen } from "@/components/login-screen";
import { PruneApp, type SignedInUser } from "@/components/prune-app";
import { clearAccessToken, readAccessToken, writeAccessToken } from "@/lib/browser-token";

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
  { ok: true; user: SignedInUser } | { ok: false; error: string }
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
      error: errorFromPayload(payload, `Could not resolve the signed-in user (${response.status}).`),
    };
  }
  const user = parseUserPayload(payload);
  if (!user) {
    return { ok: false, error: "X API returned an unexpected user payload." };
  }
  return { ok: true, user };
}

export function AppShell() {
  const [auth, setAuth] = useState<AuthState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      await Promise.resolve();
      const stored = readAccessToken();
      if (!stored) {
        if (!cancelled) setAuth({ kind: "anonymous", error: null });
        return;
      }
      const result = await resolveUser(stored);
      if (cancelled) return;
      if (!result.ok) {
        clearAccessToken();
        setAuth({ kind: "anonymous", error: result.error });
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
      clearAccessToken();
      setAuth({ kind: "anonymous", error: result.error });
      return;
    }
    writeAccessToken(token);
    setAuth({ kind: "authenticated", user: result.user });
  }

  function handleLogout() {
    clearAccessToken();
    setAuth({ kind: "anonymous", error: null });
  }

  switch (auth.kind) {
    case "loading":
      return (
        <main className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
          Checking saved token…
        </main>
      );
    case "anonymous":
      return <LoginScreen error={auth.error} busy={busy} onSubmit={(token) => void handleLogin(token)} />;
    case "authenticated":
      return <PruneApp user={auth.user} onLogout={handleLogout} />;
    default: {
      const exhaustive: never = auth;
      return exhaustive;
    }
  }
}
