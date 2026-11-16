/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { Chapter, SearchResultItem, SourceManga, Tag } from "@paperback/types";

import { rateContent } from "../utils/content-rating";
import {
  AS_DOMAIN,
  type AsuraChapter,
  type AsuraChapterResponse,
  type AsuraManga,
  type AsuraSeriesResponse,
} from "./models";

/** A future unlock date means the chapter is paywalled; absent or past means free. */
function isEarlyAccess(until: string | null | undefined): boolean {
  return Boolean(until) && new Date(until ?? "") > new Date();
}

/** `latest_chapters` is empty for a newly added series, hence the optional return. */
export function latestChapterSubtitle(manga: AsuraManga): string | undefined {
  const latest = manga.latest_chapters?.[0];
  if (!latest) return undefined;

  return `Chapter ${latest.number}${isEarlyAccess(latest.early_access_until) ? " - (Early Access)" : ""}`;
}

/** Genres ship on listing items as well as details, so tiles rate as accurately. */
export function genreNames(manga: AsuraManga): string[] {
  return manga.genres?.map((genre) => genre.name) ?? [];
}

export function toSearchResultItem(manga: AsuraManga): SearchResultItem {
  return {
    mangaId: manga.slug,
    title: manga.title,
    imageUrl: manga.cover_url ?? manga.cover,
    subtitle: latestChapterSubtitle(manga),
    contentRating: rateContent(genreNames(manga)),
  };
}

/**
 * A cache hit answers `{ series }` and a miss answers `{ data: { series } }`, so
 * any title alternates between the two as its cache entry expires.
 */
export function unwrapSeries(body: AsuraSeriesResponse): AsuraManga {
  const series = "series" in body ? body.series : body.data?.series;
  if (!series) throw new Error("AsuraScans: unexpected series payload");
  return series;
}

export function parseMangaDetails(manga: AsuraManga): SourceManga {
  const tags: Tag[] = manga.genres.map((genre) => ({ id: genre.slug, title: genre.name }));

  return {
    mangaId: manga.slug,
    mangaInfo: {
      primaryTitle: manga.title,
      secondaryTitles: manga.alt_titles,
      status: manga.status,
      // The API sends "_" where a creator is unknown.
      author: manga.author === "_" ? undefined : manga.author,
      artist: manga.artist === "_" ? undefined : manga.artist,
      tagGroups: [{ id: "0", title: "Genres", tags }],
      synopsis: manga.description.replaceAll("<p>", "").replaceAll("</p>", "\n"),
      thumbnailUrl: manga.cover_url ?? manga.cover,
      contentRating: rateContent(genreNames(manga)),
      shareUrl: `${AS_DOMAIN}/comics/${manga.slug}`,
      // Tracking endpoints address a series by numeric id, not by slug.
      additionalInfo: { id: manga.id.toString() },
    },
  };
}

export function parseChapters(
  response: AsuraChapterResponse,
  sourceManga: SourceManga,
  includeUpcoming: boolean,
): Chapter[] {
  const chapters: Chapter[] = [];

  for (const chapter of response.data) {
    if (!includeUpcoming && chapter.is_premium) continue;

    chapters.push({
      sourceManga,
      chapterId: chapter.id.toString(),
      title: chapter.is_premium ? earlyAccessTitle(chapter.title) : (chapter.title ?? undefined),
      langCode: "en",
      chapNum: chapter.number,
      volume: 0,
      sortingIndex: chapter.number,
      publishDate: releaseDate(chapter, new Date()),
      additionalInfo: chapter.is_premium ? { early_access: "true" } : undefined,
    });
  }

  return chapters;
}

function earlyAccessTitle(title: string | undefined): string {
  return title ? `${title} (Early Access)` : "Early Access";
}

/**
 * When the chapter became readable for everyone, or its publication if that is
 * still ahead. Never later than `now`: Paperback crashes when a chapter is dated
 * in the future, and an early access chapter's unlock time always is.
 */
export function releaseDate(chapter: AsuraChapter, now: Date): Date {
  const unlocked = chapter.early_access_until ? new Date(chapter.early_access_until) : undefined;
  if (unlocked && unlocked <= now) return unlocked;

  const published = new Date(chapter.published_at);
  return published <= now ? published : now;
}

export function toCreatorTags(names: string[]): Tag[] {
  return [
    { id: "all", title: "All" },
    ...names.map((name) => ({
      id: name.toLowerCase().replace(/\s/g, "-").replace(/[',]/g, ""),
      title: name,
    })),
  ];
}
