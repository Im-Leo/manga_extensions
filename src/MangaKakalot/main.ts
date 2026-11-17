/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  BasicRateLimiter,
  type ContentRating,
  CookieStorageInterceptor,
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
  type TagSection,
} from "@paperback/types";

import { TtlCache } from "../utils/cache";
import { learnMissingRatings } from "../utils/content-rating";
import { SiteInterceptor, persistCloudflareCookies } from "../utils/interceptor";
import { fetchCheerio, fetchJSON } from "../utils/network";
import { MangaKakalotAdvancedSearchForm } from "./forms/search";
import {
  DISCOVER_SECTIONS,
  DOMAIN,
  type ChapterListResponse,
  type Metadata,
  type SearchMetadata,
} from "./models";
import {
  applyLearnedRatings,
  isLastPage,
  parseChapterDetails,
  parseChapterList,
  parseDiscoverSectionItems,
  parseGenres,
  parseMangaDetails,
  parseSearchResults,
  ratableIds,
  ratingCache,
} from "./parsers";
import type MangaKakalotConfig from "./pbconfig";
import {
  chapterListUrl,
  chapterUrl,
  homeUrl,
  listingUrl,
  mangaUrl,
  searchTitle,
  searchUrl,
} from "./urls";

/** The genre list changes rarely; reading it costs the whole homepage. */
const GENRES_TTL_MS = 6 * 60 * 60 * 1000;

export class MangaKakalotExtension implements ExtensionImpl<typeof MangaKakalotConfig> {
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    // Kept below what the site tolerates: this is the one Cloudflare-protected
    // source, and a re-triggered challenge fails it closed rather than slowing it.
    numberOfRequests: 8,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly interceptor = new SiteInterceptor("main", {
    domain: DOMAIN,
    // A stale or bad path answers 404 with a page that still parses, so a non-200
    // has to fail loudly rather than yield blank fields.
    requireOk: true,
  });

  /** Persists `cf_clearance` so a solved challenge survives an app restart. */
  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private readonly genres = new TtlCache<string, TagSection>(GENRES_TTL_MS, 1);

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
    return DISCOVER_SECTIONS.map(({ id, title, type }) => ({ id, title, type }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const definition = DISCOVER_SECTIONS.find(({ id }) => id === section.id);
    if (!definition) throw new Error(`MangaKakalot: unknown discover section: ${section.id}`);

    const page = metadata?.page ?? 1;
    const $ = await fetchCheerio(listingUrl(definition.path, page));

    return {
      items: await this.withRealRatings(parseDiscoverSectionItems($, section)),
      metadata: isLastPage($) ? undefined : { page: page + 1 },
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    const genres = await this.genres.get("genres", async () => {
      const section = parseGenres(await fetchCheerio(homeUrl()));
      section.tags.sort((a, b) => a.title.localeCompare(b.title));
      return section;
    });

    return new MangaKakalotAdvancedSearchForm(query, genres);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchCheerio(searchUrl(query, page));

    return {
      items: await this.withRealRatings(
        parseSearchResults($, searchTitle(query).length > 0, query.metadata?.genres?.[0]),
      ),
      metadata: isLastPage($) ? undefined : { page: page + 1 },
    };
  }

  /**
   * Rates listing tiles from their own genres.
   *
   * Listing markup carries none, so each unknown title's detail page is read;
   * the cache bounds that to one fetch per title.
   */
  private async withRealRatings<T extends { contentRating?: ContentRating }>(
    items: T[],
  ): Promise<T[]> {
    await learnMissingRatings(ratableIds(items), ratingCache, (mangaId) =>
      this.getMangaDetails(mangaId),
    );

    return applyLearnedRatings(items);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchCheerio(mangaUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const response = await fetchJSON<ChapterListResponse>(chapterListUrl(sourceManga.mangaId));

    return parseChapterList(response, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await fetchCheerio(chapterUrl(chapter.sourceManga.mangaId, chapter.chapterId));

    return parseChapterDetails($, chapter);
  }
}

export const MangaKakalot = new MangaKakalotExtension();
