/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { Chapter, SearchResultItem, SourceManga, Tag } from "@paperback/types";

import { rateContent } from "../utils/content-rating";
import { normalizeRating } from "../utils/rating";
import {
  AS_DOMAIN,
  type AsuraChapter,
  type AsuraChapterResponse,
  type AsuraManga,
  type AsuraPaging,
  type AsuraReaderResponse,
  type AsuraSearchResult,
  type AsuraSeriesResponse,
  type PageData,
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

/**
 * Pages by the number of items actually returned, so a page shorter than requested can neither
 * skip nor repeat results.
 */
export function nextListingPage(
  listing: AsuraSearchResult,
  offset: number,
): AsuraPaging | undefined {
  const count = listing.data?.length ?? 0;
  return listing.meta?.has_more && count > 0 ? { offset: offset + count } : undefined;
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
  const tags: Tag[] = (manga.genres ?? []).map((genre) => ({ id: genre.slug, title: genre.name }));

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
      rating: normalizeRating(manga.rating, 10),
      shareUrl: `${AS_DOMAIN}/comics/${manga.slug}`,
      // Tracking endpoints address a series by numeric id, not by slug.
      additionalInfo: { id: manga.id.toString() },
    },
  };
}

/** Early access (`is_premium`) chapters are locked for readers, so they are not listed. */
export function parseChapters(response: AsuraChapterResponse, sourceManga: SourceManga): Chapter[] {
  const now = new Date();
  const chapters: Chapter[] = [];

  for (const chapter of response.data) {
    if (chapter.is_premium) continue;

    chapters.push({
      sourceManga,
      chapterId: chapter.id.toString(),
      title: chapter.title ?? undefined,
      langCode: "en",
      chapNum: chapter.number,
      volume: 0,
      sortingIndex: chapter.number,
      publishDate: releaseDate(chapter, now),
    });
  }

  return chapters;
}

/**
 * When the chapter became readable for everyone, else its publication. Never
 * later than `now`: Paperback crashes on opening a title holding a chapter
 * dated in the future.
 */
export function releaseDate(chapter: AsuraChapter, now: Date): Date {
  const unlocked = chapter.early_access_until ? new Date(chapter.early_access_until) : undefined;
  if (unlocked && unlocked <= now) return unlocked;

  const published = new Date(chapter.published_at);
  return published <= now ? published : now;
}

/**
 * The pages of a readable chapter.
 *
 * Early access is not unlocked by signing in: the API serves a locked chapter
 * to every account without paid early access, as a 200 carrying `is_locked`
 * and no pages. That is reported with the time it unlocks for everyone.
 */
export function readerPages(response: AsuraReaderResponse, signedIn: boolean): PageData[] {
  const { chapter, is_locked: locked, unlock_time: unlockTime } = response.data;
  if (!locked && chapter.pages) return chapter.pages;

  const unlocks = unlockTime ? new Date(unlockTime) : undefined;
  const when =
    unlocks && !Number.isNaN(unlocks.getTime())
      ? `It unlocks for everyone on ${unlocks.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}.`
      : "It unlocks for everyone later.";
  const access = signedIn
    ? "Your account does not have early access."
    : "Accounts with early access can read it now after signing in.";

  throw new Error(`AsuraScans: chapter ${chapter.number} is early access. ${when} ${access}`);
}
