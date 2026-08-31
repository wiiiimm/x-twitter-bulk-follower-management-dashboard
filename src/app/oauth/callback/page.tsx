import { Suspense } from "react";

import { OAuthCallback } from "@/components/oauth-callback";

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
          Finishing the access token…
        </main>
      }
    >
      <OAuthCallback />
    </Suspense>
  );
}
