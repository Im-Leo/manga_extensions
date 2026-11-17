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
  applyAdvancedFilters,
  buildFilterOptions,
  chapterReference,
  enrichLatestWithBrowseData,
  isNovel,
  parseChapterDetails,
  parseChapters,
  parseHomepageSection,
  parseSeriesDetail,
  toSearchResultItem,
  toSortableList,
} from "./parsers";
import type FlameComicsConfig from "./pbconfig";

const SECTION_POPULAR = "popular";
const SECTION_LATEST = "latest";
const SECTION_STAFF = "staff";

const PAGE_SIZE = 100;

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

type Comparator = (a: SortableListItem, b: SortableListItem) => number;

const COMPARATORS: Record<string, Comparator> = {
  latest: (a, b) => (b.updated ?? b.last_edit) - (a.updated ?? a.last_edit),
  title_asc: (a, b) => a.title.localeCompare(b.title),
  title_desc: (a, b) => b.title.localeCompare(a.title),
  likes: (a, b) => (b.likes ?? 0) - (a.likes ?? 0),
  year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
};

/** Fisher-Yates, in place. */
function shuffle(items: unknown[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
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
    const page = metadata?.page ?? 1;
    const title = (searchQuery.title ?? "").trim().toLowerCase();
    const { candidates: catalog, filters } = await this.loadCatalog();

    // Copied: sorting below is in place, and the catalog is shared across searches.
    let candidates = [...catalog];

    if (title.length > 0) {
      candidates = candidates.filter((c) => c.title.toLowerCase().includes(title));
    }

    // Filter before paginating, so pages stay dense and the next-page flag is honest.
    if (searchQuery.metadata) {
      candidates = applyAdvancedFilters(candidates, searchQuery.metadata, filters);
    }

    if (sortingOption.id === "random") {
      shuffle(candidates);
    } else {
      const comparator = COMPARATORS[sortingOption.id];
      if (comparator) candidates.sort(comparator);
    }

    const startIndex = (page - 1) * PAGE_SIZE;
    const endIndex = startIndex + PAGE_SIZE;
    const items = candidates
      .slice(startIndex, endIndex)
      .map((c) => toSearchResultItem(c, sortingOption));

    return { items, metadata: endIndex < candidates.length ? { page: page + 1 } : undefined };
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
