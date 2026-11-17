/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  ContentRating,
  type Chapter,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import { ContentRatingCache, rateContent } from "../utils/content-rating";
import { normalizeRating } from "../utils/rating";

/** Listing markup carries no genres, so tiles default until a detail page teaches this. */
const ratings = new ContentRatingCache();

/**
 * The site ships two listing templates differing only in class prefix and where
 * the subtitle sits, so one parser covers every discover section and search.
 */
export interface ListingLayout {
  item: string;
  link: string;
  cover: string;
  subtitle: string;
}

export const LAYOUT_COMPACT: ListingLayout = {
  item: "div.manga-list-1 ul.manga-list-1-list li",
  link: 'a[href^="/manga/"]',
  cover: "img.manga-list-1-cover",
  subtitle: "p.manga-list-1-item-subtitle",
};

/** {@link LAYOUT_COMPACT}'s grid, with chapter info in the subtitle slot. */
export const LAYOUT_COMPACT_WITH_CHAPTER: ListingLayout = {
  ...LAYOUT_COMPACT,
  subtitle: "ul.manga-list-4-item-part > li",
};

export const LAYOUT_DETAILED: ListingLayout = {
  item: "div.manga-list-4 ul.manga-list-4-list li",
  link: "p.manga-list-4-item-title a",
  cover: "img.manga-list-4-cover",
  subtitle: "ul.manga-list-4-item-part > li",
};

export interface ListingEntry {
  mangaId: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  contentRating: ContentRating;
}

/** `seenIds` is carried across pages and mutated here, since pages repeat entries. */
export function parseListing(
  $: CheerioAPI,
  layout: ListingLayout,
  seenIds: string[],
  browsedGenre?: string,
): ListingEntry[] {
  const entries: ListingEntry[] = [];

  const fromGenre = browsedGenre ? rateContent([browsedGenre]) : ContentRating.EVERYONE;

  $(layout.item).each((_, element) => {
    const link = $(layout.link, element).first();
    const mangaId = sanitizeId(link.attr("href")?.split("/manga/")[1] ?? "");
    const title = link.attr("title")?.trim() ?? "";
    const imageUrl = secureUrl($(layout.cover, element).attr("src") ?? "");

    if (!mangaId || !title || !imageUrl || seenIds.includes(mangaId)) return;

    seenIds.push(mangaId);
    entries.push({
      mangaId,
      title,
      imageUrl,
      subtitle: $(layout.subtitle, element).first().text().trim(),
      contentRating: fromGenre === ContentRating.EVERYONE ? ratings.recall(mangaId) : fromGenre,
    });
  });

  return entries;
}

/**
 * Pagination is a ">" link whose href carries the target page, except on the
 * templates that omit it — hence the increment fallback.
 */
export function parseNextPage($: CheerioAPI, currentPage: number): number | undefined {
  const nextLink = $(".pager-list-left a").filter((_, element) => $(element).text() === ">");
  if (nextLink.length === 0) return undefined;

  const href = nextLink.attr("href");
  if (!href) return undefined;

  const explicitPage = /\/directory\/(\d+)\.html/.exec(href)?.[1];
  return explicitPage ? Number.parseInt(explicitPage, 10) : currentPage + 1;
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
  const section = $(".detail-info");

  const tags: Tag[] = [];
  for (const node of $("a", ".detail-info-right-tag-list").toArray()) {
    const id = $(node).attr("href")?.split("/directory/")[1]?.replace(/\//g, "");
    const title = $(node).text().trim();
    if (!id || !title) continue;

    tags.push({ id: id.toLowerCase().replace(/\s+/g, "_"), title });
  }

  const tagGroups: TagSection[] = tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [];

  const author = $("p.detail-info-right-say a", section).text().trim();

  // Detail pages are the only place this site exposes genres, so the result is
  // remembered for later listing tiles of the same title.
  const contentRating = rateContent(tags.map((tag) => tag.title));
  ratings.remember(mangaId, contentRating);

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: $("span.detail-info-right-title-font", section).text().trim(),
      secondaryTitles: [],
      // The cover container is a sibling of `.detail-info`, so it is not scoped to it.
      thumbnailUrl: secureUrl(
        $(".detail-info-cover-img", $(".detail-info-cover")).attr("src") ?? "",
      ),
      synopsis: $("p.fullcontent").text().trim(),
      rating: normalizeRating(
        Number($("span.item-score", section).text().trim().replace(",", ".")),
        5,
      ),
      status:
        $(".detail-info-right-title-tip", section).text().trim().toUpperCase() === "COMPLETED"
          ? "Completed"
          : "Ongoing",
      author,
      artist: author,
      tagGroups,
      contentRating,
    },
  };
}

/** `/manga/<mangaId>/[<volume>/]<chapter>/1.html`; the volume is "v01", "vTBD" or absent. */
const CHAPTER_PATH = /\/manga\/[^/]+\/(?:(v[^/]+)\/)?(c[^/]+)\//;

/**
 * A chapter is identified by its chapter segment alone, which the site resolves without the
 * volume and which every stored id already uses. Only where numbering restarts each volume, and
 * that segment repeats, is the id qualified as "v01/c001" so each chapter stays reachable.
 */
export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const links = $("div#chapterlist ul li")
    .children("a")
    .toArray()
    .flatMap((node) => {
      const path = CHAPTER_PATH.exec($(node).attr("href")?.trim() ?? "");
      if (!path?.[2]) return [];
      return [{ volume: path[1], chapter: path[2], date: $("p.title2", node).text() }];
    });

  const occurrences = new Map<string, number>();
  for (const { chapter } of links) occurrences.set(chapter, (occurrences.get(chapter) ?? 0) + 1);

  const chapters = links.map(({ volume, chapter, date }): Chapter => {
    const chapNum = Number(/c([0-9.]+)/.exec(chapter)?.[1]);
    const volumeNumber = Number(volume?.slice(1));
    const repeated = (occurrences.get(chapter) ?? 0) > 1;

    return {
      chapterId: repeated && volume ? `${volume}/${chapter}` : chapter,
      sourceManga,
      langCode: "en",
      chapNum: Number.isNaN(chapNum) ? 0 : chapNum,
      volume: Number.isFinite(volumeNumber) && volumeNumber > 0 ? volumeNumber : undefined,
      publishDate: parseChapterDate(date),
    };
  });

  return chapters.reverse();
}

/**
 * The CDN serves covers and pages over https, but the site links them as http or
 * protocol-relative, and iOS App Transport Security blocks plain http loads.
 */
export function secureUrl(src: string): string {
  return src.replace(/^(?:https?:)?\/\//, "https://");
}

/** Ids reach Paperback as opaque keys, so restrict them to a filesystem-safe set. */
function sanitizeId(rawId: string): string {
  return decodeURIComponent(rawId.replace(/\//g, ""))
    .replace(/[^\w@.]/g, "_")
    .trim();
}

const RELATIVE_UNITS: [RegExp, number][] = [
  [/YEAR/, 31556952000],
  [/MONTH/, 2592000000],
  [/WEEK/, 604800000],
  [/DAY/, 86400000],
  [/HOUR/, 3600000],
  [/MINUTE/, 60000],
  [/SECOND/, 1000],
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Recent chapters are dated relatively ("3 days ago") until they age into "Sep 09,2015". The
 * absolute form is parsed by hand: how `Date` reads it varies between JavaScript engines.
 */
function parseChapterDate(raw: string): Date | undefined {
  const text = raw.trim().toUpperCase();

  if (text.includes("LESS THAN AN HOUR") || text.includes("JUST NOW")) return new Date();
  if (text.includes("YESTERDAY")) return new Date(Date.now() - 86400000);

  const amount = Number((/\d+/.exec(text) ?? [])[0]);
  if (amount) {
    const unit = RELATIVE_UNITS.find(([pattern]) => pattern.test(text));
    if (unit) return new Date(Date.now() - amount * unit[1]);
  }

  const absolute = /^([A-Z]{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
  const month = MONTHS.indexOf(absolute?.[1] ?? "");
  if (!absolute || month === -1) return undefined;
  return new Date(Number(absolute[3]), month, Number(absolute[2]));
}
