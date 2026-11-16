/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { expect } from "chai";
import * as cheerio from "cheerio";

import { DOMAIN } from "../MangaFox/models.js";
import {
  extractChapterPages,
  extractFallbackPages,
  extractWebtoonPages,
  parsePagePayload,
} from "../MangaFox/reader.js";
import { concatenatedLiterals, unescapeLiteral, unpack } from "../MangaFox/unpack.js";
import { rejectionOf } from "./async.js";
import { withFakeNetwork, type FakeRoute } from "./fakes/application.js";
import {
  KEY,
  KEY_PACKED_SCRIPT,
  PAGE_1_URL,
  PAGE_2_URL,
  PAGE_PAYLOAD_1,
  PAGE_PAYLOAD_2,
  PAGINATED_CHAPTER_HTML,
  PLAIN_CHAPTER_HTML,
  WEBTOON_CHAPTER_HTML,
} from "./fixtures/mangafox-reader.js";
import type { TestSuite } from "./suite.js";

const FIRST_PAGE = "page=1&";
const SECOND_PAGE = "page=2&";

const CHAPTER_URL = `${DOMAIN}/manga/onepunch_man/v01/c001/1.html`;

/** Fails the first `failures` requests, then answers with `body`. */
function flaky(failures: number, body: string): FakeRoute {
  let calls = 0;
  return () => (calls++ < failures ? { status: 503 } : { body });
}

/**
 * The page decoder, against packed scripts recorded from the live site. Nothing
 * here evaluates the site's script; decoding is pure string work.
 */
export function registerMangaFoxReaderTests(suite: TestSuite): void {
  suite.test("unpack: decodes the recorded key script without evaluating it", async () => {
    const source = unpack(KEY_PACKED_SCRIPT);

    expect(source).to.match(/^var guidkey=''\+'d'\+'b'/);
    expect(
      concatenatedLiterals(source!.slice(source!.indexOf("="), source!.indexOf(";"))),
    ).to.equal(KEY);
  });

  suite.test("unpack: anything without a packer call yields nothing", async () => {
    expect(unpack("var x = 1;")).to.equal(undefined);
    expect(unpack("")).to.equal(undefined);
  });

  suite.test("unescapeLiteral: reads JavaScript string escapes", async () => {
    expect(unescapeLiteral("it\\'s a \\\\ path")).to.equal("it's a \\ path");
    expect(unescapeLiteral("\\x41\\u0042\\n")).to.equal("AB\n");
  });

  suite.test("webtoon: every inline page URL is decoded and https", async () => {
    const pages = extractWebtoonPages(cheerio.load(WEBTOON_CHAPTER_HTML));

    expect(pages).to.have.lengthOf(57);
    expect(
      pages.every((url) => url.startsWith("https://zjcdn.mangafox.me/store/manga/46829/")),
    ).to.equal(true);
  });

  suite.test("parsePagePayload: joins pix and the first pvalue entry", async () => {
    expect(parsePagePayload(PAGE_PAYLOAD_1)).to.equal(PAGE_1_URL);
    expect(parsePagePayload(PAGE_PAYLOAD_2)).to.equal(PAGE_2_URL);
    expect(parsePagePayload("<html>error</html>")).to.equal(undefined);
  });

  suite.test("paginated: page 1 spends the key, later pages ride its session", async () => {
    await withFakeNetwork(
      [
        [`page=1&key=${KEY}`, { body: PAGE_PAYLOAD_1 }],
        ["page=2&key=", { body: PAGE_PAYLOAD_2 }],
      ],
      async (network) => {
        const pages = await extractChapterPages(cheerio.load(PAGINATED_CHAPTER_HTML), CHAPTER_URL);

        expect(pages).to.deep.equal([PAGE_1_URL, PAGE_2_URL]);
        expect(network.requests[0]?.url).to.equal(
          `${DOMAIN}/manga/onepunch_man/v01/c001/chapterfun.ashx?cid=184674&page=1&key=${KEY}`,
        );
        expect(network.requests[1]?.url, "no key after page 1").to.match(/page=2&key=$/);
        expect(network.requests[0]?.headers?.["Referer"]).to.equal(CHAPTER_URL);
      },
    );
  });

  suite.test("paginated: a transient page failure is retried", async () => {
    await withFakeNetwork(
      [
        [FIRST_PAGE, { body: PAGE_PAYLOAD_1 }],
        [SECOND_PAGE, flaky(2, PAGE_PAYLOAD_2)],
      ],
      async (network) => {
        const pages = await extractChapterPages(cheerio.load(PAGINATED_CHAPTER_HTML), CHAPTER_URL);

        expect(pages).to.deep.equal([PAGE_1_URL, PAGE_2_URL]);
        expect(network.count(SECOND_PAGE)).to.equal(3);
      },
    );
  });

  suite.test("paginated: a page that never loads fails the chapter, not silently", async () => {
    await withFakeNetwork(
      [
        [FIRST_PAGE, { body: PAGE_PAYLOAD_1 }],
        [SECOND_PAGE, { body: "<html>error</html>" }],
      ],
      async () => {
        const error = await rejectionOf(
          extractChapterPages(cheerio.load(PAGINATED_CHAPTER_HTML), CHAPTER_URL),
        );
        expect(error.message).to.contain("page 2");
      },
    );
  });

  suite.test("fallback: plain markup pages are upgraded to https", async () => {
    expect(extractFallbackPages(cheerio.load(PLAIN_CHAPTER_HTML))).to.deep.equal([
      "https://zjcdn.mangafox.me/store/manga/1/001.jpg",
      "https://zjcdn.mangafox.me/store/manga/1/002.jpg",
    ]);

    await withFakeNetwork([], async (network) => {
      const pages = await extractChapterPages(cheerio.load(PLAIN_CHAPTER_HTML), CHAPTER_URL);
      expect(pages).to.have.lengthOf(2);
      expect(network.requests, "no packed script, no page requests").to.have.lengthOf(0);
    });
  });
}
