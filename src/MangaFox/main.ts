/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type Request,
  type AdvancedSearchForm,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import { TtlCache } from "../utils/cache";
import { ContentRatingCache } from "../utils/content-rating";
import { SingleGenreSearchForm } from "../utils/forms/single-genre-search";
import { SiteInterceptor, persistCloudflareCookies } from "../utils/interceptor";
import { toDiscoverItem, type ListingEntry } from "../utils/listing";
import { fetchCheerio, fetchTitlePage } from "../utils/network";
import { DOMAIN, GENRES, type Metadata, type SearchMetadata } from "./models";
import {
  LAYOUT_COMPACT,
  LAYOUT_COMPACT_WITH_CHAPTER,
  LAYOUT_DETAILED,
  parseChapters,
  parseListing,
  parseMangaDetails,
  parseNextPage,
} from "./parsers";
import type MangaFoxConfig from "./pbconfig";
import { extractChapterPages } from "./reader";
import { chapterUrl, directoryUrl, mangaUrl, releasesUrl, searchUrl } from "./urls";

const SECTION_HOT = "hot-release";
const SECTION_NEW = "new-manga";
const SECTION_LATEST = "latest-updates";
const SECTION_GENRES = "genres";

/** Long enough to span details and chapters loading together, short enough to see new chapters. */
const DETAIL_PAGE_TTL_MS = 60 * 1000;

export class MangaFoxExtension implements ExtensionImpl<typeof MangaFoxConfig> {
  // Paginated chapters cost one request per page, so this budget sets how fast a
  // chapter opens rather than merely pacing background traffic.
  private readonly rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 12,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly interceptor = new SiteInterceptor("main", {
    domain: DOMAIN,
    // isAdult unlocks the mature listings.
    cookies: { isAdult: "1" },
  });

  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  /**
   * Details and chapters both parse the title page; opening a title asks for both.
   * Few entries, because a parsed page is large and a library refresh walks many titles.
   */
  private readonly detailPages = new TtlCache<string, CheerioAPI>(DETAIL_PAGE_TTL_MS, 4);

  /** Listing markup carries no genres, so tiles default until a detail page teaches this. */
  private readonly ratings = new ContentRatingCache();

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
    this.cookieStorage.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    persistCloudflareCookies(cookies, this.cookieStorage);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_HOT, title: "Hot Release", type: DiscoverSectionType.featured },
      { id: SECTION_NEW, title: "New Manga", type: DiscoverSectionType.prominentCarousel },
      { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_GENRES) {
      return {
        items: GENRES.map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          // Must be `metadata`: a `filters` key leaves the selection empty and the
          // endpoint quietly answers with its default listing.
          searchQuery: { title: "", metadata: { genres: [genre.id] } },
        })),
      };
    }

    const page = metadata?.page ?? 1;
    const seenIds = metadata?.collectedIds ?? [];

    switch (section.id) {
      case SECTION_HOT: {
        const $ = await fetchCheerio(DOMAIN);
        return {
          items: toItems(parseListing($, LAYOUT_COMPACT, seenIds, this.ratings), section.type),
        };
      }

      case SECTION_NEW: {
        const $ = await fetchCheerio(directoryUrl(page));
        const items = parseListing($, LAYOUT_COMPACT_WITH_CHAPTER, seenIds, this.ratings);
        return { items: toItems(items, section.type), metadata: nextMetadata($, page, seenIds) };
      }

      case SECTION_LATEST: {
        const $ = await fetchCheerio(releasesUrl(page));
        const items = parseListing($, LAYOUT_DETAILED, seenIds, this.ratings);
        return { items: toItems(items, section.type), metadata: nextMetadata($, page, seenIds) };
      }

      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    // The site appends a single `?genres=` id and has no multi-genre endpoint.
    return new SingleGenreSearchForm(query, GENRES, "The site searches one genre at a time");
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const seenIds = metadata?.collectedIds ?? [];

    const genre = query.metadata?.genres?.[0];
    // The site filters by numeric id; the rating classifier needs the genre name.
    const genreTitle = GENRES.find((entry) => entry.id === genre)?.title;

    const $ = await fetchCheerio(searchUrl(query.title, genre, page));

    return {
      items: parseListing($, LAYOUT_DETAILED, seenIds, this.ratings, genreTitle),
      metadata: nextMetadata($, page, seenIds),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await this.detailPage(mangaId), mangaId, this.ratings);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await this.detailPage(sourceManga.mangaId), sourceManga);
  }

  private detailPage(mangaId: string): Promise<CheerioAPI> {
    return this.detailPages.get(mangaId, (id) =>
      fetchTitlePage(mangaUrl(id), "MangaFox", "fanfox.net"),
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = chapterUrl(chapter.sourceManga.mangaId, chapter.chapterId);

    const pages = await extractChapterPages(await fetchCheerio(url), url);
    if (pages.length === 0) {
      throw new Error(`MangaFox: no pages found for chapter ${chapter.chapterId}`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}

function nextMetadata(
  $: Parameters<typeof parseNextPage>[0],
  page: number,
  seenIds: string[],
): Metadata | undefined {
  const next = parseNextPage($, page);
  return next ? { page: next, collectedIds: seenIds } : undefined;
}

export const MangaFox = new MangaFoxExtension();

function toItems(entries: ListingEntry[], type: DiscoverSectionType): DiscoverSectionItem[] {
  return entries.map((entry) => toDiscoverItem(entry, type));
}
