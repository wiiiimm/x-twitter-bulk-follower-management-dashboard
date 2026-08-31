import { redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const code = first(params.code);
  const error = first(params.error);
  const state = first(params.state);

  if (code || error) {
    const next = new URLSearchParams();
    if (code) {
      next.set("code", code);
    }
    if (state) {
      next.set("state", state);
    }
    if (error) {
      next.set("error", error);
    }
    const description = first(params.error_description);
    if (description) {
      next.set("error_description", description);
    }
    redirect(`/oauth/callback?${next.toString()}`);
  }

  return <AppShell />;
}
