/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { ContentRating } from "@paperback/types";

import type { ChapterData, ChapterRelationship, DatumAttributes } from "./models";
import { paperbackToMangaDexRatings } from "./ratings";
import type { PrecomputedQuery } from "./utils";
import { relevanceScore } from "./utils";

/** The pure steps of reading a chapter feed, kept apart from the paging in `chapters.ts`. */

type InlinedMangaAttributes = DatumAttributes & {
  tags?: unknown;
  latestUploadedChapter?: string;
};

/**
 * The feed inlines a partial manga on every chapter, which is enough to refresh metadata without
 * a second round trip, but it is typed as a loose relationship, so it is validated before use.
 */
export function readInlinedMangaItem(
  rel: ChapterRelationship | undefined,
): { id: string; attributes: InlinedMangaAttributes } | undefined {
  if (!rel || typeof rel.id !== "string" || !rel.attributes || typeof rel.attributes !== "object") {
    return undefined;
  }
  return { id: rel.id, attributes: rel.attributes as unknown as InlinedMangaAttributes };
}

export function extractScanlationGroupNames(chapter: ChapterData): string[] {
  return (
    chapter.relationships
      ?.filter((x: ChapterRelationship) => x?.type === "scanlation_group")
      .map((x: ChapterRelationship) => x.attributes?.["name"])
      .filter((n): n is string => !!n) ?? []
  );
}

export interface AssignedChapterNumber {
  chapNum: number;
  isUnnumbered: boolean;
}

/**
 * MangaDex allows a null chapter number, and Paperback requires one. Untitled
 * entries are numbered from their position so ordering stays stable.
 */
export function assignChapterNumber(
  rawChap: string | null | undefined,
  prevChapNum: number,
): AssignedChapterNumber {
  const rawIsEmpty = rawChap === null || rawChap === undefined || rawChap === "";
  let chapNum = rawIsEmpty ? NaN : Number(rawChap);
  const isUnnumbered = isNaN(chapNum);
  if (isUnnumbered) {
    chapNum = prevChapNum > 0 ? prevChapNum - 0.001 : 0;
  }
  return { chapNum, isUnnumbered };
}

/** Distinguishes duplicate uploads of one chapter by group and language. */
export function buildChapterIdentifier(
  chapNum: number,
  isUnnumbered: boolean,
  name: string,
  translatedLanguage: string,
  unnumberedIndex: number,
  volume: number,
  resetNumbersOnVolume: boolean,
): string {
  if (!isUnnumbered) {
    return resetNumbersOnVolume
      ? `${volume}-${chapNum}-${translatedLanguage}`
      : `${chapNum}-${translatedLanguage}`;
  }
  const key = name.trim().toLowerCase() || `idx${unnumberedIndex}`;
  return `unn-${key}-${translatedLanguage}`;
}

export function normalizePagesCount(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A stored MangaDex rating is authoritative. Without one the Paperback rating is
 * mapped back, which is lossy — several MangaDex ratings share one Paperback
 * bucket — so any of the candidates being enabled admits the chapter.
 */
export function isRatingAllowed(
  storedMdRating: string | undefined,
  mangaPbRating: ContentRating,
  enabledRatings: readonly string[],
): boolean {
  if (storedMdRating) return enabledRatings.includes(storedMdRating);
  return (paperbackToMangaDexRatings[mangaPbRating] ?? []).some((r) => enabledRatings.includes(r));
}

/**
 * Group names are matched fuzzily, since users type them by hand and the site's
 * spelling drifts. The cache matters: this runs per chapter, per feed page.
 */
export function isGroupNameBlocked(
  name: string,
  blockedGroupQueries: PrecomputedQuery[],
  groupBlockCache: Map<string, boolean>,
): boolean {
  const cached = groupBlockCache.get(name);
  if (cached !== undefined) return cached;
  const blocked = blockedGroupQueries.some((q) => relevanceScore(name, q) >= 70);
  groupBlockCache.set(name, blocked);
  return blocked;
}
