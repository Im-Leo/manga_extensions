/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { ContentRating, type Chapter, type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { FlameComics } from "../FlameComics/main.js";
import { CDN } from "../FlameComics/models.js";
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
} from "../FlameComics/parsers.js";
import sourceInfo from "../FlameComics/pbconfig.js";
import {
  assertChapter,
  assertChapterDetails,
  assertDiscoverSectionItem,
  assertSearchResultItem,
  imagePagesOf,
  assertSourceManga,
} from "./contracts.js";
import {
  CHAPTER_READER,
  HOMEPAGE,
  NOT_FOUND_PAYLOAD,
  NOVEL_BY_ID,
  NOVEL_BY_TYPE,
  SERIES_DETAIL,
  STALE_BUILD_PAYLOAD,
  SIMPLE_SERIES,
  makeSeries,
} from "./fixtures/flamecomics.js";
import { registerFlameNetworkTests } from "./flamecomics-network.js";
import { TestSuite, registerSourceTests } from "./suite.js";

const SOURCE_MANGA = {
  mangaId: "1",
  mangaInfo: { primaryTitle: "Example Series" },
} as SourceManga;

const LATEST_SORT = { id: "latest", label: "Latest Update" };

/** The option id the search form stores for `value`. */
function idOf(options: { id: string; value: string }[], value: string): string {
  return options.find((option) => option.value === value)!.id;
}

/** The rating a search tile shows for `series`. */
function rate(series: Parameters<typeof toSortableList>[0][number]) {
  const [sortable] = toSortableList([series], SIMPLE_SERIES);
  return toSearchResultItem(sortable!, LATEST_SORT).contentRating;
}

function registerOfflineTests(suite: TestSuite): void {
  suite.test("chapterReference: splits packed ids and falls back for older ones", async () => {
    const packed = { chapterId: "12:tok", sourceManga: SOURCE_MANGA } as Chapter;
    expect(chapterReference(packed)).to.deep.equal({ seriesId: "12", token: "tok" });

    const legacy = {
      chapterId: "131",
      sourceManga: SOURCE_MANGA,
      additionalInfo: { token: "tok131" },
    } as unknown as Chapter;
    expect(chapterReference(legacy)).to.deep.equal({ seriesId: "1", token: "tok131" });

    const bare = { chapterId: "1", sourceManga: SOURCE_MANGA } as Chapter;
    expect(chapterReference(bare)).to.deep.equal({ seriesId: "1", token: undefined });
  });

  suite.test("applyAdvancedFilters: single-value fields match names with spaces", async () => {
    const korean = {
      ...toSortableList([makeSeries({ series_id: 1 })], SIMPLE_SERIES)[0]!,
      type: "Web Comic",
      status: "On Hiatus",
      year: 2024,
      language: "Korean (Hangul)",
      country: "South Korea",
    };
    const other = {
      ...korean,
      series_id: 2,
      type: "Manga",
      status: "Ongoing",
      year: 2020,
      language: "Japanese",
      country: "Japan",
    };
    const options = buildFilterOptions([korean, other], {
      types: ["all", "Web Comic", "Manga"],
      status: ["all", "On Hiatus", "Ongoing"],
      year: ["all", "2024", "2020"],
      search: "",
      order: "desc",
    });
    const selections = {
      types: [idOf(options.types, "Web Comic")],
      status: [idOf(options.status, "On Hiatus")],
      year: [idOf(options.year, "2024")],
      language: idOf(options.language, "Korean (Hangul)"),
      country: idOf(options.country, "South Korea"),
    };
    for (const [field, value] of Object.entries(selections)) {
      const matched = applyAdvancedFilters([korean, other], { [field]: value }, options);
      expect(
        matched.map((item) => item.series_id),
        field,
      ).to.deep.equal([1]);
    }
  });

  suite.test("isNovel: detects novels by id and by type", async () => {
    expect(isNovel(NOVEL_BY_ID), "novel_id marks a novel").to.equal(true);
    expect(isNovel(NOVEL_BY_TYPE), '"Web Novel" type marks a novel').to.equal(true);
    expect(isNovel(makeSeries()), "a normal series is not a novel").to.equal(false);
  });

  suite.test("parseHomepageSection: filters novels out of every block", async () => {
    const popular = parseHomepageSection("popular", HOMEPAGE);

    expect(popular.items, "the novel in this block must be dropped").to.have.lengthOf(1);
    popular.items.forEach((item, index) => assertDiscoverSectionItem(item, `popular ${index}`));
    expect(popular.items[0]?.type).to.equal("featuredCarouselItem");
  });

  suite.test("parseHomepageSection: latest packs series and chapter into chapterId", async () => {
    const latest = parseHomepageSection("latest", HOMEPAGE);
    const [item] = latest.items;

    expect(item?.type).to.equal("chapterUpdatesCarouselItem");
    expect(item && "chapterId" in item ? item.chapterId : undefined).to.equal("1:tok131");
  });

  suite.test("enrichLatestWithBrowseData: backfills fields missing from latest", async () => {
    const latest = [makeSeries({ year: undefined, author: undefined })];
    const browse = [makeSeries({ year: 2021, author: ["Author One"] })];

    const [enriched] = enrichLatestWithBrowseData(latest, browse);
    expect(enriched?.year).to.equal(2021);
    expect(enriched?.author).to.deep.equal(["Author One"]);
  });

  suite.test("toSortableList: attaches chapter_count from /api/series", async () => {
    const [sortable] = toSortableList([makeSeries()], SIMPLE_SERIES);

    expect(sortable?.chapter_count).to.equal(37);
  });

  suite.test("toSearchResultItem: builds a cache-busted cover URL", async () => {
    const [sortable] = toSortableList([makeSeries()], SIMPLE_SERIES);
    const item = toSearchResultItem(sortable!, LATEST_SORT);

    assertSearchResultItem(item, "search result");
    expect(item.imageUrl).to.equal(`${CDN}/uploads/images/series/1/cover.webp?1700000000`);
  });

  suite.test("content rating: derived per title, from categories or tags", async () => {
    expect(rate(makeSeries({ tags: ["Action"] })), "a safe title").to.equal(ContentRating.EVERYONE);
    expect(rate(makeSeries({ tags: ["Adult"] })), "tags are read").to.equal(ContentRating.ADULT);
    expect(rate(makeSeries({ categories: ["Ecchi"] })), "categories are read too").to.equal(
      ContentRating.MATURE,
    );
    expect(rate(makeSeries({ categories: ["Ecchi", "Smut"] }))).to.equal(ContentRating.ADULT);
  });

  suite.test("content rating: detail and carousels rate the same title alike", async () => {
    // The detail route sends `tags` and the genre listing sends `categories`;
    // both carry genres, so neither may fall back to a constant rating.
    const detail = parseSeriesDetail("1", SERIES_DETAIL);
    expect(detail.mangaInfo.contentRating, "fixture is Action/Drama").to.equal(
      ContentRating.EVERYONE,
    );

    for (const sectionId of ["popular", "latest", "staff"]) {
      const section = parseHomepageSection(sectionId, HOMEPAGE);
      for (const item of section.items) {
        expect(item.contentRating, `${sectionId} tile carries a rating`).to.not.equal(undefined);
      }
    }
  });

  suite.test("parseSeriesDetail: maps the payload and strips markup", async () => {
    const manga = parseSeriesDetail("1", SERIES_DETAIL);
    assertSourceManga(manga, "detail");

    const info = manga.mangaInfo;
    expect(info.primaryTitle).to.equal("Example Series");
    expect(info.secondaryTitles).to.deep.equal(["Alt One"]);
    expect(info.synopsis, "tags stripped and entities decoded").to.equal("A & B synopsis");
    expect(info.author).to.equal("Author One");
    expect(info.tagGroups?.[0]?.tags.map((tag) => tag.title)).to.deep.equal(["Action", "Drama"]);
  });

  suite.test("parseChapters: parses numeric chapters and packs the token", async () => {
    const chapters = parseChapters(SOURCE_MANGA, SERIES_DETAIL);

    expect(chapters).to.have.lengthOf(2);
    chapters.forEach((chapter, index) => assertChapter(chapter, `chapter ${index}`));
    expect(chapters[0]?.chapNum, '"204.00" parses as 204').to.equal(204);
    expect(chapters[0]?.chapterId).to.equal("1:tok204");
    expect(chapters[0]?.title, "a blank title falls back to the number").to.equal("Chapter 204");
  });

  suite.test("failure envelopes do not crash the chapter parser", async () => {
    expect(parseChapters(SOURCE_MANGA, NOT_FOUND_PAYLOAD), "notFound envelope").to.deep.equal([]);
    expect(
      parseChapters(SOURCE_MANGA, STALE_BUILD_PAYLOAD),
      "stale buildId envelope",
    ).to.deep.equal([]);
  });

  suite.test("failure envelopes raise a readable error from the detail parser", async () => {
    expect(() => parseSeriesDetail("110", NOT_FOUND_PAYLOAD)).to.throw(/empty series payload/);
    expect(() => parseSeriesDetail("110", STALE_BUILD_PAYLOAD)).to.throw(/empty series payload/);
  });

  suite.test("parseChapterDetails: orders pages numerically, not lexicographically", async () => {
    const details = parseChapterDetails("1:tok204", CHAPTER_READER);
    assertChapterDetails(details, "chapter details");

    const pages = imagePagesOf(details, "chapter details");
    expect(pages.map((page) => page.split("/").pop()?.split("?")[0])).to.deep.equal([
      "page-01.jpg",
      "page-02.jpg",
      "page-10.jpg",
    ]);
  });
}

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("FlameComics tests", logger);

  registerOfflineTests(suite);
  registerFlameNetworkTests(suite);

  registerSourceTests(suite, FlameComics, sourceInfo);

  await suite.run();
}
