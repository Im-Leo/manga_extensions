/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  DiscoverSectionType,
  type ContentRating,
  type DiscoverSectionItem,
} from "@paperback/types";

/**
 * The fields a scraped listing tile carries, shared by discover items and search results. Kept
 * apart from `SearchResultItem`, whose loose `metadata: unknown` is incompatible with the
 * `JSONValue` the carousel types demand.
 */
export interface ListingEntry {
  mangaId: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  contentRating: ContentRating;
}

/** The tile a section of `type` shows for `entry`; `chapterId` is what a chapter-update tile opens. */
export function toDiscoverItem(
  entry: ListingEntry,
  type: DiscoverSectionType,
  chapterId = "",
): DiscoverSectionItem {
  switch (type) {
    case DiscoverSectionType.featured:
      return { ...entry, supertitle: entry.subtitle, type: "featuredCarouselItem" };
    case DiscoverSectionType.prominentCarousel:
      return { ...entry, type: "prominentCarouselItem" };
    case DiscoverSectionType.chapterUpdates:
      return { ...entry, chapterId, type: "chapterUpdatesCarouselItem" };
    default:
      return { ...entry, type: "simpleCarouselItem" };
  }
}
