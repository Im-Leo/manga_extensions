/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { TtlCache } from "../utils/cache";
import { SiteInterceptor, persistCloudflareCookies } from "../utils/interceptor";
import { FlameAdvancedSearchForm } from "./forms/search";
import { DOMAIN } from "./models";
import type {
  ChapterReaderResponse,
  FlameFilter,
  HomepageResponse,
  LatestProps,
  Metadata,
  SearchMetadata,
  SearchProps,
  SeriesDetailResponse,
  SimpleSeriesListItem,
  SortableListItem,
} from "./models";
import { NextDataClient, fetchSimpleSeries } from "./network";
import {
  buildFilterOptions,
  chapterReference,
  enrichLatestWithBrowseData,
  isNovel,
  parseChapterDetails,
  parseChapters,
  parseHomepageSection,
  parseSeriesDetail,
  toSortableList,
} from "./parsers";
import type FlameComicsConfig from "./pbconfig";
import { searchCatalog } from "./search";

const SECTION_POPULAR = "popular";
const SECTION_LATEST = "latest";
const SECTION_STAFF = "staff";

/** Long enough to cover one screen's worth of calls, short enough that a refresh sees new chapters. */
const PAGE_CACHE_TTL_MS = 60 * 1000;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

const HOMEPAGE_KEY = "homepage";
const CATALOG_KEY = "catalog";

/** The whole catalog, aggregated once and reused for search, filters and sort. */
interface Catalog {
  candidates: SortableListItem[];
  filters: FlameFilter;
}

export class FlameComicsExtension implements ExtensionImpl<typeof FlameComicsConfig> {
  private readonly rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 10,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private readonly cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });
  private readonly interceptor = new SiteInterceptor("main", { domain: DOMAIN });

  private readonly nextData = new NextDataClient();

  /** Every discover section reads the same homepage payload. */
  private readonly homepage = new TtlCache<string, HomepageResponse>(PAGE_CACHE_TTL_MS, 1);

  /**
   * Opening a title asks for details and chapters, which one route answers. Few
   * entries: a library refresh walks every title and none of those repeat.
   */
  private readonly series = new TtlCache<string, SeriesDetailResponse>(PAGE_CACHE_TTL_MS, 4);

  private readonly catalog = new TtlCache<string, Catalog>(CATALOG_CACHE_TTL_MS, 1);

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorage.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    persistCloudflareCookies(cookies, this.cookieStorage);
  }

  /** Latest supplies recency, browse supplies metadata, `/api/series` supplies counts. */
  private loadCatalog(): Promise<Catalog> {
    return this.catalog.get(CATALOG_KEY, async () => {
      const [latest, browse, simple] = await Promise.all([
        this.nextData.fetch<LatestProps>(["latest.json"]),
        this.nextData.fetch<SearchProps>(["browse.json"]),
        fetchSimpleSeries<SimpleSeriesListItem[]>(),
      ]);

      const nonNovels = latest.pageProps.allSeries.filter((s) => !isNovel(s));
      const enriched = enrichLatestWithBrowseData(nonNovels, browse.pageProps.series);
      const candidates = toSortableList(enriched, simple);

      return {
        candidates,
        filters: buildFilterOptions(candidates, browse.pageProps.initialFilters),
      };
    });
  }

  private loadSeries(mangaId: string): Promise<SeriesDetailResponse> {
    return this.series.get(mangaId, (id) =>
      this.nextData.fetch<SeriesDetailResponse>(["series", `${id}.json`], { id }),
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION_STAFF, title: "Staff Picks", type: DiscoverSectionType.prominentCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const homepage = await this.homepage.get(HOMEPAGE_KEY, () =>
      this.nextData.fetch<HomepageResponse>(["index.json"]),
    );
    return parseHomepageSection(section.id, homepage);
  }

  async getSearchResults(
    searchQuery: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const { candidates, filters } = await this.loadCatalog();
    return searchCatalog(candidates, filters, searchQuery, sortingOption, metadata);
  }

  async getAdvancedSearchForm(
    searchQuery: SearchQuery<SearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    const { filters } = await this.loadCatalog();
    return new FlameAdvancedSearchForm(searchQuery, filters);
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return [
      { id: "latest", label: "Latest Update" },
      { id: "title_asc", label: "Title ↑" },
      { id: "title_desc", label: "Title ↓" },
      { id: "likes", label: "Most Liked" },
      { id: "year", label: "Year" },
      { id: "random", label: "Random" },
    ];
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeriesDetail(mangaId, await this.loadSeries(mangaId));
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(sourceManga, await this.loadSeries(sourceManga.mangaId));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { seriesId, token } = chapterReference(chapter);

    if (!seriesId || !token) {
      throw new Error(
        `FlameComics: cannot open chapter ${chapter.chapterId}; its series id or token is missing.`,
      );
    }

    const response = await this.nextData.fetch<ChapterReaderResponse>(
      ["series", seriesId, `${token}.json`],
      { id: seriesId, token },
    );
    return parseChapterDetails(chapter.chapterId, response);
  }
}

export const FlameComics = new FlameComicsExtension();
