/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  ContentRating,
  DiscoverSectionType,
  type SourceManga,
  type TestLogger,
} from "@paperback/types";
import { expect } from "chai";
import * as cheerio from "cheerio";

import { MangaKakalot, MangaKakalotExtension } from "../MangaKakalot/main.js";
import { DOMAIN } from "../MangaKakalot/models.js";
import {
  isLastPage,
  parseChapterDetails,
  parseChapterList,
  parseDiscoverSectionItems,
  parseGenres,
  parseMangaDetails,
  parseSearchResults,
} from "../MangaKakalot/parsers.js";
import sourceInfo from "../MangaKakalot/pbconfig.js";
import { UNRATED_LISTING_DEFAULT } from "../utils/content-rating.js";
import { rejectionOf } from "./async.js";
import {
  assertDiscoverSectionItem,
  assertSearchResultItem,
  assertSourceManga,
  imagePagesOf,
  isMangaTile,
} from "./contracts.js";
import { withFakeNetwork } from "./fakes/application.js";
import {
  CHAPTER_LIST_FAILED_JSON,
  CHAPTER_LIST_JSON,
  DETAIL_HTML,
  DETAIL_SAFE_HTML,
  GENRES_HTML,
  LISTING_HTML,
  LISTING_LAST_PAGE_HTML,
  LISTING_SINGLE_PAGE_HTML,
  LISTING_WITH_INVALID_ENTRY_HTML,
  READER_HTML,
  SEARCH_HTML,
} from "./fixtures/mangakakalot.js";
import { registerSharedNetworkTests } from "./shared-network.js";
import { registerSharedUtilTests } from "./shared-utils.js";
import { TestSuite, registerSourceTests } from "./suite.js";

const SOURCE_MANGA = {
  mangaId: "detailed-title",
  mangaInfo: { primaryTitle: "Detailed Title" },
} as SourceManga;

function registerOfflineTests(suite: TestSuite): void {
  suite.test("parseDiscoverSectionItems: maps every entry and honors section type", async () => {
    const $ = cheerio.load(LISTING_HTML);
    const items = parseDiscoverSectionItems($, {
      id: "most_popular",
      title: "Most Popular",
      type: DiscoverSectionType.simpleCarousel,
    });

    expect(items).to.have.lengthOf(3);
    items.forEach((item, index) => assertDiscoverSectionItem(item, `item ${index}`));
    expect(items.every((item) => item.type === "simpleCarouselItem")).to.equal(true);

    const tiles = items.filter(isMangaTile);
    expect(tiles[1]?.title).to.equal("Beta & Friends");
  });

  suite.test("no discover section uses the featured hero", async () => {
    // Paperback masks grid tiles by content rating but not the featured hero, so
    // an adult cover shows there unblurred however the tile is rated. The parser
    // still handles `featured`; no section may opt into it.
    const sections = await MangaKakalot.getDiscoverSections();

    expect(sections.length, "sections are declared").to.be.greaterThan(0);
    for (const section of sections) {
      expect(section.type, `${section.id} must not be featured`).to.not.equal(
        DiscoverSectionType.featured,
      );
    }
  });

  suite.test("parseDiscoverSectionItems: featured items expose a supertitle", async () => {
    const $ = cheerio.load(LISTING_HTML);
    const [item] = parseDiscoverSectionItems($, {
      id: "new_titles",
      title: "New Titles",
      type: DiscoverSectionType.featured,
    });

    expect(item?.type).to.equal("featuredCarouselItem");
    expect(item && "supertitle" in item ? item.supertitle : undefined).to.equal("Chapter 12");
  });

  suite.test("image sources: data-src wins, relative and http are normalized", async () => {
    const $ = cheerio.load(LISTING_HTML);
    const items = parseDiscoverSectionItems($, {
      id: "most_popular",
      title: "Most Popular",
      type: DiscoverSectionType.simpleCarousel,
    });

    const tiles = items.filter(isMangaTile);
    expect(tiles[0]?.imageUrl).to.equal("https://img-r1.2xstorage.com/thumb/alpha.webp");
    expect(tiles[1]?.imageUrl).to.equal(`${DOMAIN}/uploads/beta.webp`);
    expect(tiles[2]?.imageUrl).to.equal("https://img-r2.2xstorage.com/thumb/gamma.webp");
  });

  suite.test("parseDiscoverSectionItems: drops entries with no id or title", async () => {
    const $ = cheerio.load(LISTING_WITH_INVALID_ENTRY_HTML);
    const items = parseDiscoverSectionItems($, {
      id: "most_popular",
      title: "Most Popular",
      type: DiscoverSectionType.simpleCarousel,
    });

    expect(items).to.have.lengthOf(1);
    expect(items.find(isMangaTile)?.mangaId).to.equal("valid-one");
  });

  suite.test("isLastPage: mid-listing, final page, and no pager", async () => {
    expect(isLastPage(cheerio.load(LISTING_HTML)), "page 2 of 7").to.equal(false);
    expect(isLastPage(cheerio.load(LISTING_LAST_PAGE_HTML)), "page 7 of 7").to.equal(true);
    expect(isLastPage(cheerio.load(LISTING_SINGLE_PAGE_HTML)), "no pager").to.equal(true);
  });

  suite.test("parseSearchResults: title search uses the story template", async () => {
    const results = parseSearchResults(cheerio.load(SEARCH_HTML), true);

    expect(results).to.have.lengthOf(1);
    assertSearchResultItem(results[0]!, "search result");
    expect(results[0]?.mangaId).to.equal("searched-title");
    expect(results[0]?.subtitle).to.equal("Chapter 44");
  });

  suite.test("parseSearchResults: genre browse reuses the listing template", async () => {
    // This site exposes no genres on listing pages, and an unrated tile reads as
    // safe to Paperback, so unknown must resolve to something that still blurs.
    const results = parseSearchResults(cheerio.load(LISTING_HTML), false);

    expect(results).to.have.lengthOf(3);
    results.forEach((result, index) => assertSearchResultItem(result, `genre result ${index}`));
  });

  suite.test("parseMangaDetails: extracts every field", async () => {
    const manga = parseMangaDetails(cheerio.load(DETAIL_HTML), "detailed-title");
    assertSourceManga(manga, "detail");

    const info = manga.mangaInfo;
    expect(info.primaryTitle).to.equal("Detailed Title");
    expect(info.secondaryTitles).to.deep.equal(["Second Name", "Third Name"]);
    expect(info.author).to.equal("Some Author");
    expect(info.status).to.equal("Completed");
    expect(info.rating).to.be.closeTo(1.7, 0.001);
    expect(info.synopsis).to.equal("A real synopsis follows.");
    expect(info.shareUrl).to.equal(`${DOMAIN}/manga/detailed-title`);
  });

  suite.test("parseMangaDetails: an adult genre raises the content rating", async () => {
    const adult = parseMangaDetails(cheerio.load(DETAIL_HTML), "detailed-title");
    expect(adult.mangaInfo.contentRating, "smut must map to ADULT").to.equal(ContentRating.ADULT);

    const safe = parseMangaDetails(cheerio.load(DETAIL_SAFE_HTML), "safe-title");
    expect(safe.mangaInfo.contentRating, "no adult genre stays EVERYONE").to.equal(
      ContentRating.EVERYONE,
    );
  });

  suite.test("content rating: listing tiles default to the conservative rating", async () => {
    const results = parseSearchResults(cheerio.load(LISTING_HTML), false);

    expect(results.length, "fixture has entries").to.be.greaterThan(0);
    for (const item of results) {
      expect(item.contentRating, `${item.mangaId} carries a rating`).to.equal(
        UNRATED_LISTING_DEFAULT,
      );
      expect(item.contentRating, "and it is never EVERYONE").to.not.equal(ContentRating.EVERYONE);
    }
  });

  suite.test("content rating: browsing a genre rates every tile on the page", async () => {
    const adult = parseSearchResults(cheerio.load(LISTING_HTML), false, "adult");
    for (const item of adult) {
      expect(item.contentRating, `${item.mangaId} from an adult genre`).to.equal(
        ContentRating.ADULT,
      );
    }

    const comedy = parseSearchResults(cheerio.load(LISTING_HTML), false, "comedy");
    for (const item of comedy) {
      expect(item.contentRating, "a safe genre does not assert safety").to.not.equal(
        ContentRating.EVERYONE,
      );
    }
  });

  suite.test("content rating: a rating learned from details reaches later tiles", async () => {
    const before = parseSearchResults(cheerio.load(LISTING_HTML), false).find(
      (item) => item.mangaId === "alpha-title",
    );
    expect(before?.contentRating, "not yet known").to.equal(UNRATED_LISTING_DEFAULT);

    parseMangaDetails(cheerio.load(DETAIL_SAFE_HTML), "alpha-title");

    const after = parseSearchResults(cheerio.load(LISTING_HTML), false).find(
      (item) => item.mangaId === "alpha-title",
    );
    expect(after?.contentRating, "learned from the detail page").to.equal(ContentRating.EVERYONE);
  });

  suite.test("parseChapterDetails: collects pages and drops empty sources", async () => {
    const details = parseChapterDetails(cheerio.load(READER_HTML), {
      chapterId: "chapter-1",
      sourceManga: SOURCE_MANGA,
    } as never);

    expect(imagePagesOf(details, "chapter details")).to.deep.equal([
      "https://img-r1.2xstorage.com/chapter/1.webp",
      "https://img-r1.2xstorage.com/chapter/2.webp",
    ]);
  });

  suite.test("parseGenres: keeps complete tags only", async () => {
    const genres = parseGenres(cheerio.load(GENRES_HTML));

    expect(genres.id).to.equal("genres");
    expect(genres.tags.map((tag) => tag.id)).to.deep.equal(["action", "comedy"]);
  });

  suite.test("parseChapterList: inverts sortingIndex so ordering is ascending", async () => {
    const chapters = parseChapterList(CHAPTER_LIST_JSON, SOURCE_MANGA);

    expect(chapters).to.have.lengthOf(3);
    expect(chapters.map((chapter) => chapter.sortingIndex)).to.deep.equal([3, 2, 1]);
    expect(chapters.map((chapter) => chapter.chapNum)).to.deep.equal([3, 2, 1]);
    expect(chapters[0]?.chapterId).to.equal("chapter-3");
    expect(Number.isFinite(chapters[0]!.publishDate!.getTime())).to.equal(true);
  });

  suite.test("parseChapterList: an unsuccessful payload fails instead of emptying", async () => {
    expect(() => parseChapterList(CHAPTER_LIST_FAILED_JSON, SOURCE_MANGA)).to.throw(
      "failed to load",
    );
    expect(() => parseChapterList({ success: true }, SOURCE_MANGA)).to.throw("failed to load");
  });
}

function registerRequestTests(suite: TestSuite): void {
  suite.test("requests: the search form reads the genre list once", async () => {
    const extension = new MangaKakalotExtension();

    await withFakeNetwork([[/kakamanga\.com$/, { body: GENRES_HTML }]], async (network) => {
      await extension.getAdvancedSearchForm({ title: "" });
      await extension.getAdvancedSearchForm({ title: "" });

      expect(network.requests).to.have.lengthOf(1);
    });
  });

  suite.test("requests: a non-JSON chapter list fails instead of emptying", async () => {
    await withFakeNetwork(
      [["/chapters", { body: "<!DOCTYPE html><title>Just a moment...</title>" }]],
      async () => {
        await rejectionOf(MangaKakalot.getChapters(SOURCE_MANGA));
      },
    );
  });
}

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaKakalot tests", logger);

  registerOfflineTests(suite);
  registerRequestTests(suite);

  registerSharedUtilTests(suite);
  registerSharedNetworkTests(suite);

  registerSourceTests(suite, MangaKakalot, sourceInfo);

  await suite.run();
}
