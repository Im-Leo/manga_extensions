/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  BasicRateLimiter,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type ChapterReadActionQueueProcessingResult,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type MangaProgress,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type TagSection,
  type TrackedMangaChapterReadAction,
} from "@paperback/types";

import { rateContent } from "../utils/content-rating";
import { SiteInterceptor } from "../utils/interceptor";
import { fetchJSON } from "../utils/network";
import { TrackingForm } from "./forms/progress";
import { AsuraScansAdvancedSearchForm } from "./forms/search";
import { AsuraSettingForm } from "./forms/settings";
import {
  AS_DOMAIN,
  READER_PAGE_TOKEN,
  TagSectionId,
  statuses,
  types,
  type AsuraChapterResponse,
  type AsuraGenre,
  type AsuraSeriesResponse,
  type AsuraPaging,
  type AsuraReaderResponse,
  type AsuraSearchResult,
  type SearchMetadata,
} from "./models";
import {
  genreNames,
  latestChapterSubtitle,
  nextListingPage,
  parseChapters,
  parseMangaDetails,
  readerPages,
  toSearchResultItem,
  unwrapSeries,
} from "./parsers";
import type AsuraConfig from "./pbconfig";
import { descramblePage } from "./reader";
import { getAccessToken, isSignedIn, migrateLegacySession } from "./session";
import { PersistedTagCache } from "./tags";
import { getMangaProgress, processChapterReadActionQueue } from "./tracking";
import {
  chapterListUrl,
  chapterUrl,
  genresUrl,
  listingUrl,
  searchUrl,
  seriesUrl,
  trendingUrl,
} from "./urls";

const PAGE_SIZE = 20;

export class AsuraScansExtension implements ExtensionImpl<typeof AsuraConfig> {
  private readonly rateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 6,
    bufferInterval: 1,
    // Covers must not queue behind the request budget; this CDN needs no throttle.
    ignoreImages: true,
  });

  private readonly interceptor = new SiteInterceptor("main", { domain: AS_DOMAIN });

  private readonly tags = new PersistedTagCache(() => this.fetchTagSections());

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
    migrateLegacySession();
  }

  async getSettingsForm(): Promise<Form> {
    return new AsuraSettingForm();
  }

  getMangaShareUrl(mangaId: string): string {
    return `${AS_DOMAIN}/comics/${mangaId}`;
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "featured", title: "Popular Today", type: DiscoverSectionType.featured },
      { id: "latest_updates", title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      {
        id: "popular_today",
        title: "Popular of All Time",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: "type", title: "Types", type: DiscoverSectionType.genres },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
      { id: "status", title: "Status", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: AsuraPaging | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.type === DiscoverSectionType.genres) return this.getGenreSectionItems(section.id);

    const offset = metadata?.offset ?? 0;

    if (section.type === DiscoverSectionType.featured) {
      const trending = await fetchJSON<AsuraSearchResult>(trendingUrl());

      return {
        items: (trending.data ?? []).map((manga) => ({
          type: "featuredCarouselItem" as const,
          mangaId: manga.slug,
          title: manga.title,
          imageUrl: manga.cover_url ?? manga.cover,
          contentRating: rateContent(genreNames(manga)),
        })),
      };
    }

    const sort = section.type === DiscoverSectionType.chapterUpdates ? "latest" : "popular";
    const listing = await fetchJSON<AsuraSearchResult>(listingUrl(sort, offset, PAGE_SIZE));

    const items = (listing.data ?? []).map((manga): DiscoverSectionItem => {
      const item: DiscoverSectionItem = {
        type: "simpleCarouselItem",
        mangaId: manga.slug,
        title: manga.title,
        imageUrl: manga.cover_url ?? manga.cover,
        subtitle: latestChapterSubtitle(manga),
        contentRating: rateContent(genreNames(manga)),
      };
      if (section.type !== DiscoverSectionType.chapterUpdates) return item;
      return Object.assign(item, {
        type: "chapterUpdatesCarouselItem",
        chapterId: manga.latest_chapters?.[0]?.id.toString() ?? "",
      });
    });

    return { items, metadata: nextListingPage(listing, offset) };
  }

  /** The filters the search form and the genre, status and type sections offer. */
  private async fetchTagSections(): Promise<TagSection[]> {
    const genres = await fetchJSON<{ data: AsuraGenre[] }>(genresUrl());

    return [
      {
        id: TagSectionId.Genres,
        title: "Genres",
        tags: genres.data.map((genre) => ({ id: genre.slug, title: genre.name })),
      },
      { id: TagSectionId.SeriesStatus, title: "Status", tags: statuses },
      { id: TagSectionId.SeriesType, title: "Type", tags: types },
    ];
  }

  async getAdvancedSearchForm(
    searchQuery: SearchQuery<SearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new AsuraScansAdvancedSearchForm(searchQuery, await this.tags.get());
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return [
      { id: "latest", label: "Latest Update" },
      { id: "popular", label: "Popular" },
      { id: "rating", label: "Rating" },
      { id: "title", label: "A-Z" },
      { id: "newest", label: "Newest" },
    ];
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: AsuraPaging | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const offset = metadata?.offset ?? 0;
    const listing = await fetchJSON<AsuraSearchResult>(
      searchUrl(query, sortingOption, offset, PAGE_SIZE),
    );

    return {
      items: (listing.data ?? []).map((manga) => toSearchResultItem(manga)),
      metadata: nextListingPage(listing, offset),
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const body = await fetchJSON<AsuraSeriesResponse>(seriesUrl(mangaId));

    return parseMangaDetails(unwrapSeries(body));
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const response = await fetchJSON<AsuraChapterResponse>(chapterListUrl(sourceManga.mangaId));

    return parseChapters(response, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    // Sent when available, for accounts with early access; never required, since
    // a free chapter opens without one and a locked one is reported below.
    const accessToken = await getAccessToken().catch(() => undefined);

    const payload = await fetchJSON<AsuraReaderResponse>({
      url: chapterUrl(chapter.sourceManga.mangaId, chapter.chapNum),
      method: "GET",
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        "X-Page-Token": READER_PAGE_TOKEN,
      },
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: await Promise.all(readerPages(payload, isSignedIn()).map(descramblePage)),
    };
  }

  async getMangaProgressManagementForm(sourceManga: SourceManga): Promise<Form> {
    return new TrackingForm(sourceManga);
  }

  async getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress | undefined> {
    return getMangaProgress(sourceManga, (manga) => this.getChapters(manga));
  }

  async processChapterReadActionQueue(
    actions: TrackedMangaChapterReadAction[],
  ): Promise<ChapterReadActionQueueProcessingResult> {
    return processChapterReadActionQueue(actions);
  }

  private async getGenreSectionItems(
    sectionId: string,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const tags = await this.tags.get();

    const sectionToTag: Record<string, [TagSectionId, keyof SearchMetadata]> = {
      genres: [TagSectionId.Genres, "genres"],
      status: [TagSectionId.SeriesStatus, "seriesStatus"],
      type: [TagSectionId.SeriesType, "seriesType"],
    };

    const mapping = sectionToTag[sectionId];
    if (!mapping) return { items: [] };

    const [tagSectionId, metadataKey] = mapping;
    const section = tags.find((tag) => tag.id === tagSectionId);

    return {
      items: (section?.tags ?? []).map((tag) => ({
        type: "genresCarouselItem" as const,
        name: tag.title,
        searchQuery: { title: "", metadata: { [metadataKey]: [tag.id] } },
      })),
    };
  }
}

export const AsuraScans = new AsuraScansExtension();
