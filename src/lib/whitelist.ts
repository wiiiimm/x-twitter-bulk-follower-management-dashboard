const WHITELIST_KEY = "x-twitter-bulk-follower-management-dashboard.whitelist";

const EMPTY: readonly string[] = Object.freeze([]);
const listeners = new Set<() => void>();
let snapshot: readonly string[] = EMPTY;
let loaded = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (id) ids.add(id);
    }
    return [...ids].sort();
  } catch {
    return [];
  }
}

function loadFromStorage(): readonly string[] {
  if (typeof window === "undefined") return EMPTY;
  const ids = parseIds(window.localStorage.getItem(WHITELIST_KEY));
  return ids.length === 0 ? EMPTY : Object.freeze(ids);
}

function persist(ids: Iterable<string>): void {
  const next = [...new Set([...ids].map((id) => id.trim()).filter(Boolean))].sort();
  snapshot = next.length === 0 ? EMPTY : Object.freeze(next);
  loaded = true;
  if (next.length === 0) {
    window.localStorage.removeItem(WHITELIST_KEY);
  } else {
    window.localStorage.setItem(WHITELIST_KEY, JSON.stringify(next));
  }
  emit();
}

export function subscribeWhitelist(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getWhitelistSnapshot(): readonly string[] {
  if (typeof window === "undefined") return EMPTY;
  if (!loaded) {
    snapshot = loadFromStorage();
    loaded = true;
  }
  return snapshot;
}

export function getServerWhitelistSnapshot(): readonly string[] {
  return EMPTY;
}

export function isWhitelisted(accountId: string, ids: readonly string[] = getWhitelistSnapshot()): boolean {
  return ids.includes(accountId);
}

export function addToWhitelist(accountIds: readonly string[]): void {
  persist([...getWhitelistSnapshot(), ...accountIds]);
}

export function removeFromWhitelist(accountId: string): void {
  persist(getWhitelistSnapshot().filter((id) => id !== accountId));
}
