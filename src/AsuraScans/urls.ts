/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { SearchQuery, SortingOption } from "@paperback/types";

import { URLBuilder } from "../utils/url-builder/base";
import { AS_API_DOMAIN, type SearchMetadata } from "./models";

/**
 * Every endpoint this source addresses.
 *
 * Kept apart from `main.ts` so query parameters can be asserted offline: the API
 * answers a malformed query with its default listing rather than an error, so a
 * wrong parameter fails silently against the live site.
 */

/** Path segments shared by several endpoints. */
const PATH = { series: "series", chapters: "chapters" } as const;

/** The API's query parameter names. */
const QUERY = {
  search: "search",
  sort: "sort",
  order: "order",
  genres: "genres",
  status: "status",
  type: "type",
  limit: "limit",
  offset: "offset",
} as const;

/** "repeat" is the array style the API expects for multi-value keys. */
const api = () => new URLBuilder(AS_API_DOMAIN, "repeat").addPath("api");

export const trendingUrl = (limit = 10): string =>
  api().addPath("trending").addPath("daily").addQuery(QUERY.limit, limit.toString()).build();

export const genresUrl = (): string => api().addPath("genres").build();

export const creatorsUrl = (): string => api().addPath("creators").build();

export const seriesUrl = (mangaId: string): string =>
  api().addPath(PATH.series).addPath(mangaId).build();

export const chapterListUrl = (mangaId: string): string =>
  api().addPath(PATH.series).addPath(mangaId).addPath(PATH.chapters).build();

/** The reader addresses a chapter by number, unlike every other endpoint. */
export const chapterUrl = (mangaId: string, chapNum: number): string =>
  api()
    .addPath(PATH.series)
    .addPath(mangaId)
    .addPath(PATH.chapters)
    .addPath(chapNum.toString())
    .build();

export const authUrl = (action: "login" | "refresh"): string =>
  api().addPath("auth").addPath(action).build();

/** Bookmarks are searchable only by title; free text is encoded here, as the builder does not. */
export const bookmarkSearchUrl = (title: string): string =>
  api()
    .addPath("me")
    .addPath("bookmarks")
    .addQuery(QUERY.search, encodeURIComponent(title))
    .build();

export const bookmarkUrl = (seriesId: string): string =>
  api().addPath("bookmarks").addPath(seriesId).build();

export const bookmarkReadUrl = (seriesId: string, chapterNum: number): string =>
  api()
    .addPath("bookmarks")
    .addPath(seriesId)
    .addPath("read")
    .addPath(chapterNum.toString())
    .build();

/** A discover listing is a search with nothing filtered. */
export const listingUrl = (sort: string, offset: number, limit: number): string =>
  api()
    .addPath(PATH.series)
    .addQuery(QUERY.sort, sort)
    .addQuery(QUERY.order, "desc")
    .addQuery(QUERY.offset, offset)
    .addQuery(QUERY.limit, limit)
    .build();

/**
 * Apostrophes and the word fragment after them break the API's matcher, so they
 * collapse to "%", widening the match instead of failing it.
 */
const searchTerm = (title: string): string =>
  encodeURIComponent(title.replace(/[’‘´`'-][a-z]*/g, "%"));

export function searchUrl(
  query: SearchQuery<SearchMetadata>,
  sortingOption: SortingOption | undefined,
  offset: number,
  limit: number,
): string {
  let url = api().addPath(PATH.series);

  if (query.title) url = url.addQuery(QUERY.search, searchTerm(query.title));

  url = url.addQuery(QUERY.sort, sortingOption?.id ?? "latest");
  url = url.addQuery(QUERY.order, query.metadata?.orderIsDescending ? "desc" : "asc");

  if (query.metadata?.genres?.length) {
    url = url.addQuery(QUERY.genres, query.metadata.genres.join(","));
  }

  const status = query.metadata?.seriesStatus?.[0];
  if (status && status !== "all") url = url.addQuery(QUERY.status, status);

  const seriesType = query.metadata?.seriesType?.[0];
  if (seriesType && seriesType !== "all") {
    // The API has no "mangatoon" type; those series are served under "manga".
    url = url.addQuery(QUERY.type, seriesType === "mangatoon" ? "manga" : seriesType);
  }

  return url.addQuery(QUERY.limit, limit).addQuery(QUERY.offset, offset).build();
}
