/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { TagSection } from "@paperback/types";

import { singleFlight } from "../utils/cache";

/**
 * Search tags persisted across launches.
 *
 * Building them costs the genre and creator lists, and three discover sections
 * plus the search form all read them, so they are cached. The cache expires so
 * that genres and creators added on the site eventually appear.
 */

const TAGS_KEY = "tags";

export const TAGS_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredTags {
  sections: TagSection[];
  fetchedAt: number;
}

/** Entries from before the cache carried a timestamp are bare arrays, and read as absent. */
function readStored(): StoredTags | undefined {
  const stored = Application.getState(TAGS_KEY) as StoredTags | undefined;
  return stored && Array.isArray(stored.sections) && typeof stored.fetchedAt === "number"
    ? stored
    : undefined;
}

export function clearCachedTags(): void {
  Application.setState(undefined, TAGS_KEY);
}

export class PersistedTagCache {
  private readonly refresh: () => Promise<TagSection[]>;

  constructor(
    load: () => Promise<TagSection[]>,
    private readonly now: () => number = Date.now,
  ) {
    this.refresh = singleFlight(async () => {
      const sections = await load();
      Application.setState({ sections, fetchedAt: this.now() } satisfies StoredTags, TAGS_KEY);
      return sections;
    });
  }

  /** A failed refresh falls back to expired tags rather than leaving search without filters. */
  async get(): Promise<TagSection[]> {
    const stored = readStored();
    if (stored && this.now() - stored.fetchedAt < TAGS_TTL_MS) return stored.sections;

    try {
      return await this.refresh();
    } catch (error) {
      if (stored) return stored.sections;
      throw error;
    }
  }
}
