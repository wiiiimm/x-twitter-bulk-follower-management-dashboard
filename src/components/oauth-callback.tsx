"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { readAppCredentials } from "@/lib/browser-token";
import { exchangeAuthorizationCode } from "@/lib/oauth-client";
import {
  clearPkceSession,
  readPkceSession,
  writeOAuthRedirectError,
} from "@/lib/oauth";

function queryValue(params: URLSearchParams, key: string): string {
  return params.get(key)?.trim() ?? "";
}

export function OAuthCallback() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      const oauthError = queryValue(searchParams, "error");
      const errorDescription = queryValue(searchParams, "error_description");
      const code = queryValue(searchParams, "code");
      const state = queryValue(searchParams, "state");
      const pkce = readPkceSession();
      const credentials = readAppCredentials();

      if (oauthError) {
        const message = errorDescription
          ? `X login was refused: ${errorDescription} (${oauthError}).`
          : `X login was refused (${oauthError}).`;
        if (!cancelled) {
          writeOAuthRedirectError(message);
          clearPkceSession();
          window.location.replace("/");
        }
        return;
      }

      if (!pkce) {
        if (!cancelled) {
          setError("This login attempt expired. Generate an access token again from the home page.");
        }
        return;
      }

      if (!state || state !== pkce.state) {
        clearPkceSession();
        if (!cancelled) {
          setError("The login state did not match. Generate an access token again.");
        }
        return;
      }

      if (!code) {
        clearPkceSession();
        if (!cancelled) {
          setError("X did not return an authorization code.");
        }
        return;
      }

      if (credentials.clientId.trim() !== pkce.clientId) {
        clearPkceSession();
        if (!cancelled) {
          setError("Saved Client ID does not match this login attempt.");
        }
        return;
      }

      if (!credentials.clientSecret.trim()) {
        clearPkceSession();
        if (!cancelled) {
          setError("Client Secret is missing from this browser. Paste it on the login screen.");
        }
        return;
      }

      const result = await exchangeAuthorizationCode({
        code,
        codeVerifier: pkce.verifier,
        redirectUri: pkce.redirectUri,
        credentials,
      });
      clearPkceSession();
      if (cancelled) return;
      if (!result.ok) {
        writeOAuthRedirectError(result.error);
        window.location.replace("/");
        return;
      }
      window.location.replace("/");
    }

    void finish();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (error) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-4 px-4 py-10">
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>Could not finish generating the access token</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to login
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
      Finishing the access token…
    </main>
  );
}
