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
import { ContentRatingCache, RatingResolver } from "../utils/content-rating";
import { SingleGenreSearchForm } from "../utils/forms/single-genre-search";
import { SiteInterceptor, persistCloudflareCookies } from "../utils/interceptor";
import { fetchCheerio, fetchJSON, fetchTitlePage } from "../utils/network";
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

  /**
   * Listing markup carries no genres, so tiles default until a detail page teaches
   * this. Persisted: resolving a listing costs one request per tile, and without
   * it every app launch pays that again.
   */
  private readonly ratings = new ContentRatingCache("content_ratings");

  private readonly ratingResolver = new RatingResolver(this.ratings, (mangaId) =>
    this.getMangaDetails(mangaId),
  );

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
      items: await this.withRealRatings(parseDiscoverSectionItems($, section, this.ratings)),
      metadata: isLastPage($) ? undefined : { page: page + 1 },
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    const genres = await this.genres.get("genres", async () => {
      const section = parseGenres(await fetchCheerio(homeUrl()));
      section.tags.sort((a, b) => a.title.localeCompare(b.title));
      return section;
    });

    // Genres are scraped from the homepage; the site browses one through /genre/<id>.
    return new SingleGenreSearchForm(query, genres.tags, "The site browses one genre at a time");
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchCheerio(searchUrl(query, page));

    return {
      items: await this.withRealRatings(
        parseSearchResults(
          $,
          searchTitle(query).length > 0,
          this.ratings,
          query.metadata?.genres?.[0],
        ),
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
    await this.ratingResolver.resolve(ratableIds(items));

    return applyLearnedRatings(items, this.ratings);
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(
      await fetchTitlePage(mangaUrl(mangaId), "MangaKakalot", "kakamanga.com"),
      mangaId,
      this.ratings,
    );
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
