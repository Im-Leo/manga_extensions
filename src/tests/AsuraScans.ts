/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  ContentRating,
  DiscoverSectionType,
  type SourceManga,
  type TestLogger,
} from "@paperback/types";
import { expect } from "chai";

import { AsuraScans, AsuraScansExtension } from "../AsuraScans/main.js";
import { AS_API_DOMAIN, AS_DOMAIN } from "../AsuraScans/models.js";
import {
  latestChapterSubtitle,
  nextListingPage,
  parseChapters,
  parseMangaDetails,
  releaseDate,
  toSearchResultItem,
  unwrapSeries,
} from "../AsuraScans/parsers.js";
import sourceInfo from "../AsuraScans/pbconfig.js";
import { PersistedTagCache, TAGS_TTL_MS, clearCachedTags } from "../AsuraScans/tags.js";
import {
  chapterListUrl,
  chapterUrl,
  genresUrl,
  listingUrl,
  searchUrl,
  seriesUrl,
  trendingUrl,
} from "../AsuraScans/urls.js";
import { UNRATED_LISTING_DEFAULT } from "../utils/content-rating.js";
import { registerAsuraSessionTests } from "./asurascans-session.js";
import { rejectionOf } from "./async.js";
import { assertChapter, assertSearchResultItem, assertSourceManga } from "./contracts.js";
import { withFakeNetwork } from "./fakes/application.js";
import { FUTURE_DATE, PAST_DATE, makeChapter, makeManga } from "./fixtures/asurascans.js";
import { TestSuite, registerSourceTests } from "./suite.js";

const SOURCE_MANGA = {
  mangaId: "example-series",
  mangaInfo: { primaryTitle: "Example Series" },
} as SourceManga;

function registerOfflineTests(suite: TestSuite): void {
  suite.test("latestChapterSubtitle: survives an empty chapter list", async () => {
    expect(latestChapterSubtitle(makeManga({ latest_chapters: [] }))).to.equal(undefined);
  });

  suite.test("latestChapterSubtitle: flags only future unlock dates", async () => {
    expect(latestChapterSubtitle(makeManga()), "no unlock date").to.equal("Chapter 12");

    expect(
      latestChapterSubtitle(
        makeManga({ latest_chapters: [makeChapter({ early_access_until: PAST_DATE })] }),
      ),
      "a past date is already readable",
    ).to.equal("Chapter 12");

    expect(
      latestChapterSubtitle(
        makeManga({ latest_chapters: [makeChapter({ early_access_until: FUTURE_DATE })] }),
      ),
      "a future date is early access",
    ).to.equal("Chapter 12 - (Early Access)");
  });

  suite.test("toSearchResultItem: prefers cover_url over cover", async () => {
    const withPreferred = toSearchResultItem(makeManga());
    assertSearchResultItem(withPreferred, "search result");
    expect(withPreferred.imageUrl).to.equal("https://cdn.asurascans.com/covers/preferred.webp");

    const fallback = toSearchResultItem(makeManga({ cover_url: undefined }));
    expect(fallback.imageUrl).to.equal("https://cdn.asurascans.com/covers/fallback.webp");
  });

  suite.test("unwrapSeries: reads the bare envelope", async () => {
    const manga = makeManga();
    expect(unwrapSeries({ series: manga })).to.equal(manga);
  });

  suite.test("unwrapSeries: reads the data-wrapped envelope", async () => {
    const manga = makeManga();
    expect(unwrapSeries({ data: { series: manga } })).to.equal(manga);
  });

  suite.test("unwrapSeries: rejects a payload without a series", async () => {
    expect(() => unwrapSeries({} as never)).to.throw("unexpected series payload");
  });

  suite.test("parseMangaDetails: maps the payload", async () => {
    const manga = parseMangaDetails(makeManga());
    assertSourceManga(manga, "detail");

    const info = manga.mangaInfo;
    expect(info.primaryTitle).to.equal("Example Series");
    expect(info.secondaryTitles).to.deep.equal(["Alt One"]);
    expect(info.synopsis).to.equal("First line.\n\nSecond & last\nline.");
    expect(info.tagGroups?.[0]?.tags).to.deep.equal([{ id: "action", title: "Action" }]);
    expect(info.additionalInfo?.["id"]).to.equal("42");
    expect(info.shareUrl).to.equal(`${AS_DOMAIN}/comics/example-series`);
  });

  suite.test('parseMangaDetails: treats "_" as an unknown creator', async () => {
    const manga = parseMangaDetails(makeManga({ author: "_", artist: "_" }));

    expect(manga.mangaInfo.author, "placeholder must not be displayed").to.equal(undefined);
    expect(manga.mangaInfo.artist).to.equal(undefined);
  });

  suite.test("content rating: derived from the title's own genres, not the source", async () => {
    // A source-level rating would assert EVERYONE for adult titles, and an
    // assertion is not something a user's content setting can override.
    const safe = parseMangaDetails(makeManga());
    expect(safe.mangaInfo.contentRating, "action is not mature").to.equal(ContentRating.EVERYONE);

    const adult = parseMangaDetails(
      makeManga({ genres: [{ id: 2, slug: "adult", name: "Adult" }] }),
    );
    expect(adult.mangaInfo.contentRating).to.equal(ContentRating.ADULT);

    const mature = parseMangaDetails(
      makeManga({ genres: [{ id: 3, slug: "ecchi", name: "Ecchi" }] }),
    );
    expect(mature.mangaInfo.contentRating).to.equal(ContentRating.MATURE);
  });

  suite.test("content rating: listing tiles rate as accurately as details", async () => {
    const adult = makeManga({ genres: [{ id: 4, slug: "smut", name: "Smut" }] });

    expect(toSearchResultItem(adult).contentRating).to.equal(ContentRating.ADULT);
    expect(toSearchResultItem(adult).contentRating, "tile and detail must agree").to.equal(
      parseMangaDetails(adult).mangaInfo.contentRating,
    );
  });

  suite.test("parseMangaDetails: reports the 0-10 score on the 0-1 scale", async () => {
    expect(parseMangaDetails(makeManga({ rating: 9.2 })).mangaInfo.rating).to.be.closeTo(
      0.92,
      1e-9,
    );
    expect(parseMangaDetails(makeManga({ rating: 0 })).mangaInfo.rating, "unrated").to.equal(
      undefined,
    );
  });

  suite.test("parseMangaDetails: a payload without genres has no tags", async () => {
    const details = parseMangaDetails(makeManga({ genres: undefined }));
    expect(details.mangaInfo.tagGroups?.flatMap((group) => group.tags).length ?? 0).to.equal(0);
  });

  suite.test("content rating: a payload without genres is not treated as safe", async () => {
    const missing = makeManga({ genres: undefined });
    expect(missing.genres, "fixture really omits genres").to.equal(undefined);
    expect(toSearchResultItem(missing).contentRating).to.equal(UNRATED_LISTING_DEFAULT);
  });

  suite.test("urls: endpoint paths", async () => {
    expect(trendingUrl()).to.contain("/api/trending/daily");
    expect(trendingUrl(), "carousel size is capped").to.contain("limit=10");
    expect(genresUrl()).to.equal(`${AS_API_DOMAIN}/api/genres`);
    expect(seriesUrl("example-series")).to.equal(`${AS_API_DOMAIN}/api/series/example-series`);
    expect(chapterListUrl("example-series")).to.equal(
      `${AS_API_DOMAIN}/api/series/example-series/chapters`,
    );
    expect(chapterUrl("example-series", 12)).to.equal(
      `${AS_API_DOMAIN}/api/series/example-series/chapters/12`,
    );
  });

  suite.test(
    "nextListingPage: advances by the items returned, not the size requested",
    async () => {
      const short = Array.from({ length: 10 }, (_, i) => makeManga({ slug: `s${i}` }));

      expect(nextListingPage({ data: short, meta: { has_more: true } }, 40)).to.deep.equal({
        offset: 50,
      });
      expect(nextListingPage({ data: short, meta: { has_more: false } }, 40)).to.equal(undefined);
      expect(nextListingPage({ data: null, meta: { has_more: true } }, 0)).to.equal(undefined);
      expect(
        nextListingPage({ data: [], meta: { has_more: true } }, 0),
        "no endless paging",
      ).to.equal(undefined);
    },
  );

  suite.test("chapters: a title opening costs one chapter list request", async () => {
    const extension = new AsuraScansExtension();
    const sourceManga = { mangaId: "example-series", mangaInfo: {} } as SourceManga;

    await withFakeNetwork([["/chapters", { body: { data: [] } }]], async (network) => {
      // Details and progress both read the chapter list as the title opens.
      await Promise.all([extension.getChapters(sourceManga), extension.getChapters(sourceManga)]);
      expect(network.count("/chapters")).to.equal(1);
    });
  });

  suite.test("search form: loading its filters costs one genre request", async () => {
    clearCachedTags();
    const extension = new AsuraScansExtension();
    const genres = { body: { data: [{ id: 1, slug: "action", name: "Action" }] } };

    try {
      await withFakeNetwork([["/api/genres", genres]], async (network) => {
        await extension.getAdvancedSearchForm({ title: "" });
        expect(network.requests.map((request) => request.url)).to.deep.equal([genresUrl()]);
      });
    } finally {
      clearCachedTags();
    }
  });

  suite.test("discover: carousel tiles prefer cover_url, like search", async () => {
    const extension = new AsuraScansExtension();
    const manga = makeManga({ cover: "small.webp", cover_url: "full.webp" });
    const listing = { body: { data: [manga], meta: { has_more: false } } };

    await withFakeNetwork([["/api/series", listing]], async () => {
      for (const type of [DiscoverSectionType.simpleCarousel, DiscoverSectionType.chapterUpdates]) {
        const page = await extension.getDiscoverSectionItems(
          { id: "section", title: "", type },
          undefined,
        );
        expect(page.items.length, `section ${type}`).to.equal(1);
        expect((page.items[0] as { imageUrl: string }).imageUrl, `section ${type}`).to.equal(
          "full.webp",
        );
      }
    });
  });

  suite.test("urls: listing paginates by offset, newest first", async () => {
    const url = listingUrl("latest", 40, 20);

    expect(url).to.contain("sort=latest");
    expect(url).to.contain("order=desc");
    expect(url).to.contain("offset=40");
    expect(url).to.contain("limit=20");
  });

  suite.test("urls: search defaults and sort ordering", async () => {
    const plain = searchUrl({ title: "" }, undefined, 0, 20);

    expect(plain, "default sort").to.contain("sort=latest");
    expect(plain, "default order matches the form's descending toggle").to.contain("order=desc");
    expect(plain, "no search key when the title is empty").to.not.contain("search=");

    const descending = searchUrl(
      { title: "", metadata: { orderIsDescending: true } },
      { id: "rating", label: "Rating" },
      0,
      20,
    );
    expect(descending).to.contain("sort=rating");
    expect(descending).to.contain("order=desc");

    const ascending = searchUrl(
      { title: "", metadata: { orderIsDescending: false } },
      undefined,
      0,
      20,
    );
    expect(ascending).to.contain("order=asc");
  });

  suite.test("urls: search collapses apostrophes to a wildcard", async () => {
    const url = searchUrl({ title: "Devil's Line" }, undefined, 0, 20);

    expect(url, "the fragment after the apostrophe is dropped").to.not.contain("s%20Line");
    expect(url, "a wildcard takes its place").to.contain("%25");
  });

  suite.test("urls: search filters are omitted when set to all", async () => {
    const all = searchUrl(
      { title: "", metadata: { seriesStatus: ["all"], seriesType: ["all"] } },
      undefined,
      0,
      20,
    );
    expect(all, "status=all is not a filter").to.not.contain("status=");
    expect(all, "type=all is not a filter").to.not.contain("type=");

    const filtered = searchUrl(
      {
        title: "",
        metadata: {
          genres: ["action", "drama"],
          seriesStatus: ["ongoing"],
          seriesType: ["manhwa"],
        },
      },
      undefined,
      0,
      20,
    );
    expect(filtered, "genres are comma joined").to.contain("genres=action,drama");
    expect(filtered).to.contain("status=ongoing");
    expect(filtered).to.contain("type=manhwa");
  });

  suite.test("urls: mangatoon is served under the manga type", async () => {
    const url = searchUrl({ title: "", metadata: { seriesType: ["mangatoon"] } }, undefined, 0, 20);

    expect(url).to.contain("type=manga");
    expect(url).to.not.contain("mangatoon");
  });

  suite.test("parseChapters: locked early access chapters are never listed", async () => {
    const chapters = parseChapters(
      {
        data: [
          makeChapter({ id: 2, number: 2, is_premium: true, early_access_until: FUTURE_DATE }),
          makeChapter({ id: 1, number: 1 }),
        ],
      },
      SOURCE_MANGA,
    );

    expect(chapters.map((chapter) => chapter.chapNum)).to.deep.equal([1]);
  });

  suite.test("parseChapters: a chapter that became free is dated when it unlocked", async () => {
    const [chapter] = parseChapters(
      { data: [makeChapter({ early_access_until: PAST_DATE })] },
      SOURCE_MANGA,
    );

    expect(chapter?.publishDate?.toISOString()).to.equal(new Date(PAST_DATE).toISOString());
  });

  suite.test("releaseDate: never dated in the future", async () => {
    // Paperback crashes on opening a title holding a future-dated chapter.
    const now = new Date("2026-01-01T00:00:00Z");
    const scheduled = makeChapter({ published_at: "2026-06-01T00:00:00Z" });
    const unlocking = makeChapter({ early_access_until: "2026-02-01T00:00:00Z" });

    expect(releaseDate(scheduled, now).toISOString()).to.equal(now.toISOString());
    expect(releaseDate(unlocking, now).toISOString(), "unlock and publication both ahead").to.equal(
      now.toISOString(),
    );
  });

  suite.test("parseChapters: produces valid chapters", async () => {
    const chapters = parseChapters({ data: [makeChapter()] }, SOURCE_MANGA);

    expect(chapters).to.have.lengthOf(1);
    chapters.forEach((chapter, index) => assertChapter(chapter, `chapter ${index}`));
    expect(chapters[0]?.sortingIndex).to.equal(12);
  });
}

const GENRES_SECTION = [
  { id: "genres", title: "Genres", tags: [{ id: "action", title: "Action" }] },
];

function registerTagCacheTests(suite: TestSuite): void {
  suite.test("tags: concurrent readers share one load, and the result persists", async () => {
    clearCachedTags();
    let loads = 0;
    const cache = new PersistedTagCache(async () => {
      loads++;
      return GENRES_SECTION;
    });

    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(loads).to.equal(1);

    const relaunched = new PersistedTagCache(async () => {
      loads++;
      return [];
    });
    expect(await relaunched.get(), "served from state after a relaunch").to.deep.equal(
      GENRES_SECTION,
    );
    expect(loads).to.equal(1);
  });

  suite.test("tags: expire after a day, and a failed refresh keeps the old ones", async () => {
    clearCachedTags();
    let time = 0;
    let failing = false;
    let loads = 0;
    const cache = new PersistedTagCache(
      async () => {
        loads++;
        if (failing) throw new Error("offline");
        return GENRES_SECTION;
      },
      () => time,
    );

    await cache.get();
    time = TAGS_TTL_MS;
    await cache.get();
    expect(loads, "reloaded once expired").to.equal(2);

    failing = true;
    time = 2 * TAGS_TTL_MS;
    expect(await cache.get(), "stale beats empty").to.deep.equal(GENRES_SECTION);

    clearCachedTags();
    await rejectionOf(cache.get());
  });

  suite.test("tags: a cache written before timestamps is reloaded", async () => {
    Application.setState(GENRES_SECTION, "tags");
    let loads = 0;
    const cache = new PersistedTagCache(async () => {
      loads++;
      return GENRES_SECTION;
    });

    await cache.get();
    expect(loads).to.equal(1);
    clearCachedTags();
  });
}

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("AsuraScans tests", logger);

  registerOfflineTests(suite);
  registerAsuraSessionTests(suite);
  registerTagCacheTests(suite);

  registerSourceTests(suite, AsuraScans, sourceInfo);

  await suite.run();
}
