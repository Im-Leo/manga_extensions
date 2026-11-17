/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { PagedResults, SearchQuery, SearchResultItem, SortingOption } from "@paperback/types";

import type { FlameFilter, Metadata, SearchMetadata, SortableListItem } from "./models";
import { applyAdvancedFilters, toSearchResultItem } from "./parsers";

/**
 * Search runs locally: the site has no search endpoint, so the whole catalog is aggregated once
 * and matched, filtered, sorted and paged here.
 */

const PAGE_SIZE = 100;

type Comparator = (a: SortableListItem, b: SortableListItem) => number;

const COMPARATORS: Record<string, Comparator> = {
  latest: (a, b) => (b.updated ?? b.last_edit) - (a.updated ?? a.last_edit),
  title_asc: (a, b) => a.title.localeCompare(b.title),
  title_desc: (a, b) => b.title.localeCompare(a.title),
  likes: (a, b) => (b.likes ?? 0) - (a.likes ?? 0),
  year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
};

export function searchCatalog(
  catalog: readonly SortableListItem[],
  filters: FlameFilter,
  query: SearchQuery<SearchMetadata>,
  sortingOption: SortingOption,
  metadata: Metadata | undefined,
): PagedResults<SearchResultItem> {
  const page = metadata?.page ?? 1;
  const title = (query.title ?? "").trim().toLowerCase();

  // Copied: sorting below is in place, and the catalog is shared across searches.
  let candidates = [...catalog];

  if (title.length > 0) {
    candidates = candidates.filter((c) => c.title.toLowerCase().includes(title));
  }

  // Filter before paginating, so pages stay dense and the next-page flag is honest.
  if (query.metadata) {
    candidates = applyAdvancedFilters(candidates, query.metadata, filters);
  }

  const seed = metadata?.seed ?? randomSeed();
  if (sortingOption.id === "random") {
    seededShuffle(candidates, seed);
  } else {
    const comparator = COMPARATORS[sortingOption.id];
    if (comparator) candidates.sort(comparator);
  }

  const startIndex = (page - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const items = candidates
    .slice(startIndex, endIndex)
    .map((c) => toSearchResultItem(c, sortingOption));

  return {
    items,
    metadata: endIndex < candidates.length ? { page: page + 1, seed } : undefined,
  };
}

/** A fresh seed for a random ordering that later pages must repeat. */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000);
}

/**
 * Fisher-Yates in place, driven by mulberry32 so a seed reproduces the same order. Each page of a
 * random sort reshuffles the catalog, so only a shared seed keeps pages from overlapping.
 */
function seededShuffle(items: unknown[], seed: number): void {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
