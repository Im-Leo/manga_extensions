/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { URL, type SearchQuery } from "@paperback/types";

import { DOMAIN, type SearchMetadata } from "./models";

/** The chapter API is unpaginated in practice; one oversized page fetches all. */
const CHAPTER_PAGE_SIZE = 9000;

export function homeUrl(): string {
  return DOMAIN;
}

export function listingUrl(path: string, page: number): string {
  return `${DOMAIN}/manga-list/${path}?page=${page}`;
}

export function mangaUrl(mangaId: string): string {
  return `${DOMAIN}/manga/${mangaId}`;
}

export function chapterListUrl(mangaId: string): string {
  return `${DOMAIN}/api/manga/${mangaId}/chapters?limit=${CHAPTER_PAGE_SIZE}&offset=0`;
}

export function chapterUrl(mangaId: string, chapterId: string): string {
  return `${DOMAIN}/manga/${mangaId}/${chapterId}`;
}

/**
 * Title search, genre browse and the default listing are three separate
 * endpoints; the site has no combined query.
 */
export function searchUrl(query: SearchQuery<SearchMetadata>, page: number): string {
  const url = new URL(DOMAIN);
  const genre = query.metadata?.genres?.[0];

  if (query.title) {
    url.addPathComponent("search");
    url.addPathComponent("story");
    url.addPathComponent(encodeURIComponent(sanitizeQuery(query.title)));
  } else if (genre) {
    url.addPathComponent("genre");
    url.addPathComponent(genre);
  } else {
    url.addPathComponent("manga-list");
    url.addPathComponent("latest-manga");
  }

  url.setQueryItem("page", page.toString());
  return url.toString();
}

/** Apostrophes and dots break the search path; quotes are rejected outright. */
function sanitizeQuery(title: string): string {
  return title
    .replace(/'[^ ]*/g, "")
    .replace(/\.+/g, "")
    .replace(/["']/g, "")
    .trim();
}
