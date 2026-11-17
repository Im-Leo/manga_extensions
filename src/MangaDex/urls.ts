/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { URL } from "@paperback/types";

import { MANGADEX_API } from "./models";
import { FEED_PAGE_LIMIT } from "./utils";

/** The API's query parameter names. */
const QUERY = {
  authorOrArtist: "authorOrArtist",
  availableTranslatedLanguage: "availableTranslatedLanguage[]",
  contentRating: "contentRating[]",
  createdAtSince: "createdAtSince",
  excludedTags: "excludedTags[]",
  excludedTagsMode: "excludedTagsMode",
  excludedGroups: "excludedGroups[]",
  excludedUploaders: "excludedUploaders[]",
  group: "group",
  hasAvailableChapters: "hasAvailableChapters",
  ids: "ids[]",
  includeEmptyPages: "includeEmptyPages",
  includeExternalUrl: "includeExternalUrl",
  includeFutureUpdates: "includeFutureUpdates",
  includes: "includes[]",
  includeUnavailable: "includeUnavailable",
  includedTags: "includedTags[]",
  includedTagsMode: "includedTagsMode",
  limit: "limit",
  locales: "locales[]",
  manga: "manga[]",
  name: "name",
  offset: "offset",
  orderChapter: "order[chapter]",
  orderCreatedAt: "order[createdAt]",
  orderName: "order[name]",
  orderReadableAt: "order[readableAt]",
  orderVolume: "order[volume]",
  originalLanguage: "originalLanguage[]",
  publicationDemographic: "publicationDemographic[]",
  publishAtSince: "publishAtSince",
  status: "status[]",
  title: "title",
  translatedLanguage: "translatedLanguage[]",
  uploader: "uploader[]",
  year: "year",
} as const;

const DESCENDING = "desc";

function setIfNonEmpty(url: URL, key: string, values: readonly string[] | undefined): void {
  if (values && values.length > 0) {
    url.setQueryItem(key, values as string[]);
  }
}

export interface MangaListUrlOptions {
  limit: number;
  offset?: number;
  ratings: readonly string[];
  languages?: readonly string[];
  includes?: readonly string[];
  hasAvailableChapters?: boolean;
  /** The full key, e.g. `"order[followedCount]"`. Pair with `orderValue`. */
  orderKey?: string;
  orderValue?: "asc" | "desc";
  ids?: readonly string[];
  demographics?: readonly string[];
  statuses?: readonly string[];
  originalLanguages?: readonly string[];
  year?: number;
  authorOrArtist?: string;
  group?: string;
  title?: string;
  createdAtSince?: string;
  includedTags?: readonly string[];
  excludedTags?: readonly string[];
  includedTagsMode?: string;
  excludedTagsMode?: string;
}

export function buildMangaListUrl(opts: MangaListUrlOptions): URL {
  const url = new URL(MANGADEX_API)
    .addPathComponent("manga")
    .setQueryItem(QUERY.limit, opts.limit.toString())
    .setQueryItem(QUERY.contentRating, opts.ratings as string[]);
  setIfNonEmpty(url, QUERY.availableTranslatedLanguage, opts.languages);
  setIfNonEmpty(url, QUERY.includes, opts.includes ?? ["cover_art"]);
  setIfNonEmpty(url, QUERY.ids, opts.ids);
  setIfNonEmpty(url, QUERY.publicationDemographic, opts.demographics);
  setIfNonEmpty(url, QUERY.status, opts.statuses);
  setIfNonEmpty(url, QUERY.originalLanguage, opts.originalLanguages);
  if (opts.offset !== undefined) {
    url.setQueryItem(QUERY.offset, opts.offset.toString());
  }
  if (opts.hasAvailableChapters) {
    url.setQueryItem(QUERY.hasAvailableChapters, "true");
  }
  if (opts.orderKey && opts.orderValue) {
    url.setQueryItem(opts.orderKey, opts.orderValue);
  }
  if (opts.year !== undefined) {
    url.setQueryItem(QUERY.year, opts.year.toString());
  }
  if (opts.authorOrArtist) {
    url.setQueryItem(QUERY.authorOrArtist, opts.authorOrArtist);
  }
  if (opts.group) {
    url.setQueryItem(QUERY.group, opts.group);
  }
  if (opts.title) url.setQueryItem(QUERY.title, opts.title);
  if (opts.createdAtSince) url.setQueryItem(QUERY.createdAtSince, opts.createdAtSince);
  setIfNonEmpty(url, QUERY.includedTags, opts.includedTags);
  setIfNonEmpty(url, QUERY.excludedTags, opts.excludedTags);
  if (opts.includedTagsMode) url.setQueryItem(QUERY.includedTagsMode, opts.includedTagsMode);
  if (opts.excludedTagsMode) url.setQueryItem(QUERY.excludedTagsMode, opts.excludedTagsMode);
  return url;
}

export function buildMangaByIdUrl(mangaId: string, includes?: readonly string[]): URL {
  const url = new URL(MANGADEX_API).addPathComponent("manga").addPathComponent(mangaId);
  if (includes && includes.length > 0) {
    url.setQueryItem(QUERY.includes, includes as string[]);
  }
  return url;
}

export interface MangaFeedUrlOptions {
  mangaId: string;
  offset: number;
  includes: readonly string[];
  blockedGroups: readonly string[];
  blockedUploaders?: readonly string[];
  ratings: readonly string[];
  languages: readonly string[];
  publishAtSince: string | undefined;
  /** Sets all three include params together: `isUnavailable`, `pages=0`, `externalUrl`. */
  includeUnavailable?: boolean;
}

export function buildMangaFeedUrl(opts: MangaFeedUrlOptions): URL {
  const url = new URL(MANGADEX_API)
    .addPathComponent("manga")
    .addPathComponent(opts.mangaId)
    .addPathComponent("feed")
    .setQueryItem(QUERY.limit, FEED_PAGE_LIMIT.toString())
    .setQueryItem(QUERY.offset, opts.offset.toString())
    .setQueryItem(QUERY.includes, opts.includes as string[])
    .setQueryItem(QUERY.excludedGroups, opts.blockedGroups as string[])
    .setQueryItem(QUERY.orderChapter, DESCENDING)
    .setQueryItem(QUERY.orderVolume, DESCENDING)
    .setQueryItem(QUERY.orderCreatedAt, DESCENDING)
    .setQueryItem(QUERY.contentRating, opts.ratings as string[])
    .setQueryItem(QUERY.translatedLanguage, opts.languages as string[])
    .setQueryItem(QUERY.includeFutureUpdates, "0");
  setIfNonEmpty(url, QUERY.excludedUploaders, opts.blockedUploaders);
  if (opts.publishAtSince) {
    url.setQueryItem(QUERY.publishAtSince, opts.publishAtSince);
  }
  if (opts.includeUnavailable) {
    url.setQueryItem(QUERY.includeUnavailable, "1");
    url.setQueryItem(QUERY.includeEmptyPages, "1");
    url.setQueryItem(QUERY.includeExternalUrl, "1");
  }
  return url;
}

export function buildMangaAggregateUrl(
  mangaId: string,
  translatedLanguages?: readonly string[],
): URL {
  const url = new URL(MANGADEX_API)
    .addPathComponent("manga")
    .addPathComponent(mangaId)
    .addPathComponent("aggregate");
  setIfNonEmpty(url, QUERY.translatedLanguage, translatedLanguages);
  return url;
}

export function buildMangaStatusListUrl(): URL {
  return new URL(MANGADEX_API).addPathComponent("manga").addPathComponent("status");
}

export function buildMangaStatusWriteUrl(mangaId: string): URL {
  return new URL(MANGADEX_API)
    .addPathComponent("manga")
    .addPathComponent(mangaId)
    .addPathComponent("status");
}

export interface ChapterBatchUrlOptions {
  chapterIds: readonly string[];
  languages: readonly string[];
  ratings: readonly string[];
  includeFutureUpdates?: boolean;
}

export function buildChapterBatchUrl(opts: ChapterBatchUrlOptions): URL {
  return new URL(MANGADEX_API)
    .addPathComponent("chapter")
    .setQueryItem(QUERY.ids, opts.chapterIds as string[])
    .setQueryItem(QUERY.limit, opts.chapterIds.length.toString())
    .setQueryItem(QUERY.translatedLanguage, opts.languages as string[])
    .setQueryItem(QUERY.contentRating, opts.ratings as string[])
    .setQueryItem(QUERY.includeFutureUpdates, opts.includeFutureUpdates ? "1" : "0");
}

export interface LatestChaptersUrlOptions {
  limit: number;
  offset: number;
  languages: readonly string[];
  ratings: readonly string[];
  uploaders?: readonly string[];
  excludedUploaders?: readonly string[];
  excludedGroups?: readonly string[];
  includes?: readonly string[];
}

export function buildLatestChaptersUrl(opts: LatestChaptersUrlOptions): URL {
  const url = new URL(MANGADEX_API)
    .addPathComponent("chapter")
    .setQueryItem(QUERY.limit, opts.limit.toString())
    .setQueryItem(QUERY.offset, opts.offset.toString())
    .setQueryItem(QUERY.translatedLanguage, opts.languages as string[])
    .setQueryItem(QUERY.contentRating, opts.ratings as string[])
    .setQueryItem(QUERY.orderReadableAt, DESCENDING)
    .setQueryItem(QUERY.includeFutureUpdates, "0");
  setIfNonEmpty(url, QUERY.uploader, opts.uploaders);
  setIfNonEmpty(url, QUERY.excludedUploaders, opts.excludedUploaders);
  setIfNonEmpty(url, QUERY.excludedGroups, opts.excludedGroups);
  setIfNonEmpty(url, QUERY.includes, opts.includes);
  return url;
}

export function buildChapterByIdUrl(chapterId: string, includes?: readonly string[]): URL {
  const url = new URL(MANGADEX_API).addPathComponent("chapter").addPathComponent(chapterId);
  setIfNonEmpty(url, QUERY.includes, includes);
  return url;
}

export function buildAtHomeServerUrl(chapterId: string, forcePort443?: boolean): string {
  return `${MANGADEX_API}/at-home/server/${chapterId}${forcePort443 ? "?forcePort443=true" : ""}`;
}

export function buildStatisticsForMangaUrl(mangaId: string): URL {
  return new URL(MANGADEX_API)
    .addPathComponent("statistics")
    .addPathComponent("manga")
    .addPathComponent(mangaId);
}

export function buildStatisticsBatchUrl(mangaIds: readonly string[]): URL {
  return new URL(MANGADEX_API)
    .addPathComponent("statistics")
    .addPathComponent("manga")
    .setQueryItem(QUERY.manga, mangaIds as string[]);
}

export function buildCustomListUrl(listId: string): string {
  return `${MANGADEX_API}/list/${listId}`;
}

export function buildUserListsUrl(userId: string, limit: number): URL {
  return new URL(MANGADEX_API)
    .addPathComponent("user")
    .addPathComponent(userId)
    .addPathComponent("list")
    .setQueryItem(QUERY.limit, limit.toString());
}

export function buildLegacyMappingUrl(): string {
  return `${MANGADEX_API}/legacy/mapping`;
}

export function buildTagListUrl(): string {
  return `${MANGADEX_API}/manga/tag`;
}

export interface CoverSearchUrlOptions {
  mangaId: string;
  limit: number;
  locales?: readonly string[];
  orderVolume?: "asc" | "desc";
}

export function buildCoverSearchUrl(opts: CoverSearchUrlOptions): URL {
  const url = new URL(MANGADEX_API)
    .addPathComponent("cover")
    .setQueryItem(QUERY.manga, [opts.mangaId])
    .setQueryItem(QUERY.limit, opts.limit.toString())
    .setQueryItem(QUERY.orderVolume, opts.orderVolume ?? "asc");
  setIfNonEmpty(url, QUERY.locales, opts.locales);
  return url;
}

export interface GroupSearchUrlOptions {
  limit: number;
  offset: number;
  name?: string;
}

export function buildGroupSearchUrl(opts: GroupSearchUrlOptions): URL {
  const url = new URL(MANGADEX_API)
    .addPathComponent("group")
    .setQueryItem(QUERY.limit, opts.limit.toString())
    .setQueryItem(QUERY.offset, opts.offset.toString())
    .setQueryItem(QUERY.orderName, "asc");
  if (opts.name && opts.name.trim() !== "") {
    url.setQueryItem(QUERY.name, opts.name.trim());
  }
  return url;
}
