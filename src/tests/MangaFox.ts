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

import { MangaFox, MangaFoxExtension } from "../MangaFox/main.js";
import { DOMAIN } from "../MangaFox/models.js";
import type { SearchMetadata } from "../MangaFox/models.js";
import {
  LAYOUT_COMPACT,
  LAYOUT_DETAILED,
  parseChapters,
  parseListing,
  parseMangaDetails,
  parseNextPage,
} from "../MangaFox/parsers.js";
import sourceInfo from "../MangaFox/pbconfig.js";
import { chapterUrl, directoryUrl, mangaUrl, releasesUrl, searchUrl } from "../MangaFox/urls.js";
import { UNRATED_LISTING_DEFAULT } from "../utils/content-rating.js";
import { rejectionOf } from "./async.js";
import { assertDiscoverSectionItem, assertSourceManga } from "./contracts.js";
import { withFakeNetwork } from "./fakes/application.js";
import {
  CHAPTER_LIST_HTML,
  DATED_CHAPTER_LIST_HTML,
  VOLUME_RESTART_CHAPTER_LIST_HTML,
  COMPACT_LISTING_HTML,
  DETAILED_LISTING_HTML,
  DETAIL_ADULT_HTML,
  DETAIL_MATURE_HTML,
  DETAIL_SAFE_HTML,
  LISTING_MISSING_COVER_HTML,
  PAGER_ABSENT_HTML,
  PAGER_WITHOUT_HREF_HTML,
} from "./fixtures/mangafox.js";
import { registerMangaFoxReaderTests } from "./mangafox-reader.js";
import { TestSuite, registerSourceTests } from "./suite.js";

const SOURCE_MANGA = {
  mangaId: "sword_king",
  mangaInfo: { primaryTitle: "Sword King" },
} as SourceManga;

/**
 * Pinned for the live tests. Searching with an empty title lists the newest
 * additions first, and a title added minutes ago often has no chapters yet,
 * which fails the chapter step on behavior that is correct.
 */
const LIVE_MANGA_ID = "onepunch_man";

function registerOfflineTests(suite: TestSuite): void {
  suite.test("parseListing: compact layout", async () => {
    // Listing markup here carries title, cover, chapter and a star score, but no
    // genres, so unknown must resolve to something that still blurs.
    const entries = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, []);

    expect(entries).to.have.lengthOf(2);
    expect(entries[0]).to.deep.include({
      mangaId: "first_title",
      title: "First Title",
      subtitle: "Ch.120",
    });
  });

  suite.test("urls: every page URL is final, so no redirect downgrades it to http", async () => {
    expect(searchUrl("sword king", undefined, 1)).to.equal(`${DOMAIN}/search?title=sword%20king`);
    expect(searchUrl("   ", "9", 2)).to.equal(`${DOMAIN}/search?page=2&genres=9`);
    expect(mangaUrl("sword_king")).to.equal(`${DOMAIN}/manga/sword_king/`);
    expect(releasesUrl(1)).to.equal(`${DOMAIN}/releases/`);
    expect(releasesUrl(3)).to.equal(`${DOMAIN}/releases/3.html`);
    expect(directoryUrl(1)).to.equal(`${DOMAIN}/directory/?news`);
    expect(directoryUrl(2)).to.equal(`${DOMAIN}/directory/2.html?news`);
    expect(chapterUrl("sword_king", "c001.1")).to.equal(`${DOMAIN}/manga/sword_king/c001.1/1.html`);
  });

  suite.test("covers: http and protocol-relative sources are upgraded to https", async () => {
    const entries = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, []);
    expect(entries.map((entry) => entry.imageUrl)).to.deep.equal([
      "https://fmcdn.mfcdn.net/store/manga/1/cover.jpg?token=a",
      "https://fmcdn.mfcdn.net/store/manga/2/cover.jpg?token=b",
    ]);

    const detail = parseMangaDetails(cheerio.load(DETAIL_SAFE_HTML), "safe_title");
    expect(detail.mangaInfo.thumbnailUrl).to.equal(
      "https://fmcdn.mfcdn.net/store/manga/9/cover.jpg?token=z",
    );
  });

  suite.test("parseListing: detailed layout takes the first part as subtitle", async () => {
    const entries = parseListing(cheerio.load(DETAILED_LISTING_HTML), LAYOUT_DETAILED, []);

    expect(entries).to.have.lengthOf(1);
    expect(entries[0]?.mangaId).to.equal("third_title");
    expect(entries[0]?.subtitle, "only the first part element is used").to.equal("Ch.55");
  });

  suite.test("content rating: listing tiles default to the conservative rating", async () => {
    const entries = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, []);

    expect(entries.length, "fixture has entries").to.be.greaterThan(0);
    for (const entry of entries) {
      expect(entry.contentRating, `${entry.mangaId} carries a rating`).to.equal(
        UNRATED_LISTING_DEFAULT,
      );
    }
  });

  suite.test("content rating: browsing a genre rates every tile on the page", async () => {
    const adult = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, [], "Adult");
    for (const entry of adult) {
      expect(entry.contentRating).to.equal(ContentRating.ADULT);
    }

    const comedy = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, [], "Comedy");
    for (const entry of comedy) {
      expect(entry.contentRating, "must not assert safety").to.not.equal(ContentRating.EVERYONE);
    }
  });

  suite.test("content rating: a rating learned from details reaches later tiles", async () => {
    const before = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, [])[0];
    expect(before?.contentRating, "not yet known").to.equal(UNRATED_LISTING_DEFAULT);

    parseMangaDetails(cheerio.load(DETAIL_SAFE_HTML), before?.mangaId ?? "");

    const after = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, [])[0];
    expect(after?.contentRating, "learned from the detail page").to.equal(ContentRating.EVERYONE);
  });

  suite.test("parseListing: de-duplicates across pages via seenIds", async () => {
    const seenIds: string[] = [];
    const first = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, seenIds);
    const second = parseListing(cheerio.load(COMPACT_LISTING_HTML), LAYOUT_COMPACT, seenIds);

    expect(first).to.have.lengthOf(2);
    expect(second, "already-seen entries must be suppressed").to.have.lengthOf(0);
    expect(seenIds).to.deep.equal(["first_title", "second_title"]);
  });

  suite.test("parseListing: drops entries with no cover", async () => {
    const entries = parseListing(cheerio.load(LISTING_MISSING_COVER_HTML), LAYOUT_DETAILED, []);
    expect(entries).to.have.lengthOf(0);
  });

  suite.test("parseNextPage: explicit href, fallback, and absent", async () => {
    expect(parseNextPage(cheerio.load(COMPACT_LISTING_HTML), 1), "href carries the page").to.equal(
      4,
    );
    expect(parseNextPage(cheerio.load(PAGER_WITHOUT_HREF_HTML), 2), "no href").to.equal(undefined);
    expect(parseNextPage(cheerio.load(PAGER_ABSENT_HTML), 2), "no pager").to.equal(undefined);
  });

  suite.test("parseMangaDetails: extracts every field", async () => {
    const manga = parseMangaDetails(cheerio.load(DETAIL_SAFE_HTML), "safe_title");
    assertSourceManga(manga, "detail");

    const info = manga.mangaInfo;
    expect(info.primaryTitle).to.equal("Safe Title");
    expect(info.status).to.equal("Ongoing");
    expect(info.author).to.equal("Someone");
    expect(info.rating, "4,3 out of 5").to.be.closeTo(0.86, 1e-9);
    expect(info.tagGroups?.[0]?.tags.map((tag) => tag.title)).to.deep.equal(["Comedy", "Romance"]);
  });

  suite.test("parseMangaDetails: rating comes from the title's own tags", async () => {
    expect(
      parseMangaDetails(cheerio.load(DETAIL_SAFE_HTML), "safe").mangaInfo.contentRating,
      "Comedy/Romance must not be ADULT",
    ).to.equal(ContentRating.EVERYONE);

    expect(
      parseMangaDetails(cheerio.load(DETAIL_MATURE_HTML), "mature").mangaInfo.contentRating,
      "Ecchi is MATURE",
    ).to.equal(ContentRating.MATURE);

    expect(
      parseMangaDetails(cheerio.load(DETAIL_ADULT_HTML), "adult").mangaInfo.contentRating,
      "Adult outranks MATURE",
    ).to.equal(ContentRating.ADULT);
  });

  suite.test("parseChapters: keeps dotted ids and sorts ascending", async () => {
    const chapters = parseChapters(cheerio.load(CHAPTER_LIST_HTML), SOURCE_MANGA);

    expect(chapters).to.have.lengthOf(3);
    expect(chapters.map((chapter) => chapter.chapterId)).to.deep.equal(["c001.1", "c002", "c003"]);
    expect(chapters[0]?.chapNum, "c001.1 parses as 1.1").to.be.closeTo(1.1, 0.001);
    expect(chapters.every((chapter) => Number.isFinite(chapter.publishDate!.getTime()))).to.equal(
      true,
    );
  });

  suite.test("parseChapters: reads absolute dates and never yields an invalid one", async () => {
    const chapters = parseChapters(cheerio.load(DATED_CHAPTER_LIST_HTML), SOURCE_MANGA);
    const dates = chapters.map((chapter) => chapter.publishDate);

    expect(dates[0], "unparseable dates are omitted").to.equal(undefined);
    expect(dates[1]?.getTime()).to.equal(new Date(2026, 9, 16).getTime());
    expect(dates[2]?.getTime()).to.equal(new Date(2015, 8, 9).getTime());
  });

  suite.test("parseChapters: qualifies only ids a volume restart would repeat", async () => {
    const chapters = parseChapters(cheerio.load(VOLUME_RESTART_CHAPTER_LIST_HTML), SOURCE_MANGA);

    expect(chapters.map((chapter) => chapter.chapterId)).to.deep.equal([
      "v01/c001",
      "c003",
      "v02/c001",
      "c002",
    ]);
    expect(chapters.map((chapter) => chapter.volume)).to.deep.equal([1, 1, 2, 2]);
    expect(chapterUrl("dr.stone_side", "v01/c001")).to.equal(
      `${DOMAIN}/manga/dr.stone_side/v01/c001/1.html`,
    );
  });

  suite.test("genres carousel emits metadata, not the 0.8 filters key", async () => {
    const { items } = await MangaFox.getDiscoverSectionItems(
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
      undefined,
    );

    expect(items.length, "genre carousel must not be empty").to.be.greaterThan(0);
    items.slice(0, 3).forEach((item, index) => assertDiscoverSectionItem(item, `genre ${index}`));

    const first = items[0];
    expect(first?.type).to.equal("genresCarouselItem");

    const query = first && "searchQuery" in first ? first.searchQuery : undefined;
    expect(query?.metadata, "searchQuery must carry metadata").to.not.equal(undefined);
    expect(query && "filters" in query, "the 0.8 filters key must be gone").to.equal(false);
    expect((query?.metadata as SearchMetadata | undefined)?.genres?.length).to.equal(1);
  });

  suite.test("advanced search form round-trips a genre selection", async () => {
    const form = await MangaFox.getAdvancedSearchForm({ title: "", metadata: { genres: ["19"] } });

    expect(form.getSearchQueryMetadata()).to.deep.equal({ genres: ["19"] });
    expect(form.getSections().length, "one genre section").to.equal(1);
  });
}

function registerRequestTests(suite: TestSuite): void {
  suite.test(
    "requests: opening a title fetches its page once for details and chapters",
    async () => {
      const extension = new MangaFoxExtension();
      const sourceManga = { mangaId: "safe_title", mangaInfo: { primaryTitle: "Safe Title" } };

      await withFakeNetwork(
        [["/manga/safe_title", { body: DETAIL_SAFE_HTML }]],
        async (network) => {
          const details = await extension.getMangaDetails("safe_title");
          await extension.getChapters(sourceManga as SourceManga);

          expect(details.mangaInfo.primaryTitle).to.equal("Safe Title");
          expect(network.count("/manga/safe_title")).to.equal(1);
        },
      );
    },
  );

  suite.test(
    "requests: a title removed from the site says so, for details and updates",
    async () => {
      const extension = new MangaFoxExtension();
      const sourceManga = { mangaId: "removed_title", mangaInfo: { primaryTitle: "Removed" } };

      await withFakeNetwork(
        [["/manga/removed_title", { status: 404, body: "<title>404</title>" }]],
        async () => {
          const details = await rejectionOf(extension.getMangaDetails("removed_title"));
          const chapters = await rejectionOf(extension.getChapters(sourceManga as SourceManga));

          for (const error of [details, chapters]) {
            expect(error.message).to.contain("no longer on fanfox.net");
            expect(error.message).to.contain("Migrate it");
          }
        },
      );
    },
  );

  suite.test("requests: other failures keep their status", async () => {
    const extension = new MangaFoxExtension();

    await withFakeNetwork([["/manga/busy_title", { status: 503 }]], async () => {
      const error = await rejectionOf(extension.getMangaDetails("busy_title"));
      expect(error.message).to.contain("503");
    });
  });
}

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaFox tests", logger);

  registerOfflineTests(suite);
  registerRequestTests(suite);
  registerMangaFoxReaderTests(suite);

  registerSourceTests(suite, MangaFox, sourceInfo, {
    mangaProviding: { getMangaDetails: [LIVE_MANGA_ID] },
  });

  await suite.run();
}
