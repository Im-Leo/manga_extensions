/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { URL } from "@paperback/types";

import { CDN, DOMAIN } from "./models";

/** The homepage, which carries the current build id. */
export function homeUrl(): string {
  return `${DOMAIN}/`;
}

/** A `_next/data` route under build id `buildId`. */
export function dataUrl(
  buildId: string,
  segments: string[],
  query?: Record<string, string>,
): string {
  const url = new URL(DOMAIN)
    .addPathComponent("_next")
    .addPathComponent("data")
    .addPathComponent(buildId);
  for (const segment of segments) url.addPathComponent(segment);
  for (const [key, value] of Object.entries(query ?? {})) url.setQueryItem(key, value);
  return url.toString();
}

export function simpleSeriesUrl(): string {
  return new URL(DOMAIN).addPathComponent("api").addPathComponent("series").toString();
}

export function seriesShareUrl(seriesId: number | string): string {
  return `${DOMAIN}/series/${seriesId}`;
}

/** `last_edit` serves as the cache-buster; covers are replaced in place. */
export function seriesCoverUrl(
  seriesId: number | string,
  cover: string,
  lastEdit: number | string,
): string {
  return `${CDN}/uploads/images/series/${seriesId}/${cover}?${lastEdit}`;
}

export function chapterImageUrl(seriesId: number | string, token: string, name: string): string {
  return `${CDN}/uploads/images/series/${seriesId}/${token}/${encodeURIComponent(name)}?${token}`;
}
