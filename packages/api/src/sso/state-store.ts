export interface StateEntry {
  connectionId: string;
  codeVerifier: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const store = new Map<string, StateEntry>();

export const stateStore = {
  set(key: string, entry: StateEntry): void {
    store.set(key, entry);
  },

  /** Returns entry and deletes it (one-time use). Returns null if missing or expired. */
  get(key: string): StateEntry | null {
    const entry = store.get(key);
    if (!entry) return null;
    store.delete(key); // consume
    if (Date.now() - entry.createdAt > TTL_MS) return null;
    return entry;
  },

  clear(): void {
    store.clear();
  },
};
