/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

/**
 * Request coalescing for the moments the app asks for the same thing at once:
 * every discover section loading on launch, or a title opening, which calls
 * details and chapters back to back.
 */

/**
 * Collapses concurrent calls into the one already in flight. Once it settles the
 * next call starts fresh, so a failure is never replayed to later callers.
 */
export function singleFlight<T>(load: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | undefined;

  return () =>
    (inFlight ??= load().finally(() => {
      inFlight = undefined;
    }));
}

interface Entry<V> {
  readonly value: Promise<V>;
  readonly expiresAt: number;
}

/**
 * Remembers each key's result for `ttlMs`, sharing one in-flight load per key.
 *
 * The promise itself is stored, so a second caller arriving mid-request joins it
 * instead of issuing a duplicate. A rejected load is evicted at once: caching a
 * failure would turn one network blip into a minute of errors.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 50,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K, load: (key: K) => Promise<V>): Promise<V> {
    const time = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > time) return hit.value;

    const value = load(key);
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: time + this.ttlMs });
    this.evict(time);

    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });

    return value;
  }

  /** Drops a value known to be stale, so the next `get` reloads it. */
  delete(key: K): void {
    this.entries.delete(key);
  }

  private evict(time: number): void {
    if (this.entries.size <= this.maxEntries) return;

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= time) this.entries.delete(key);
    }

    // Map iterates in insertion order, and a refreshed key is re-inserted, so the
    // first keys are the least recently loaded.
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(key);
    }
  }
}
