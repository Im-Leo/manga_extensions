/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { DiscoverSection, SourceManga } from "@paperback/types";
import { expect } from "chai";

import { FlameComicsExtension } from "../FlameComics/main.js";
import { rejectionOf } from "./async.js";
import { withFakeNetwork, type FakeRoute, type RouteTable } from "./fakes/application.js";
import {
  HOMEPAGE,
  NOT_FOUND_PAYLOAD,
  SERIES_DETAIL,
  SIMPLE_SERIES,
  STALE_BUILD_PAYLOAD,
  makeSeries,
} from "./fixtures/flamecomics.js";
import type { TestSuite } from "./suite.js";

const SERIES_ROUTE = "/series/1.json";
const BUILD_ID = "build-1";
const NEXT_BUILD_ID = "build-2";

/** The homepage alone; a substring would also match every data route. */
const HOME = /flamecomics\.xyz\/$/;

const HOME_HTML = (buildId: string) =>
  `<script id="__NEXT_DATA__">{"props":{},"buildId":"${buildId}"}</script>`;

/** Serves the homepage with each id in turn, repeating the last. */
function buildIds(...ids: string[]): FakeRoute {
  let served = 0;
  return () => ({ body: HOME_HTML(ids[Math.min(served++, ids.length - 1)] ?? "") });
}

const SECTIONS = ["popular", "latest", "staff"].map((id) => ({ id }) as DiscoverSection);

const SOURCE_MANGA = { mangaId: "1", mangaInfo: { primaryTitle: "Series" } } as SourceManga;

const CATALOG_ROUTES: RouteTable = [
  ["/latest.json", { body: { pageProps: { allSeries: [makeSeries()], keywordsMeta: "" } } }],
  [
    "/browse.json",
    {
      body: {
        pageProps: {
          series: [makeSeries()],
          initialFilters: { year: [], search: "", status: ["all"], types: ["all"], order: "desc" },
        },
      },
    },
  ],
  ["/api/series", { body: SIMPLE_SERIES }],
  [HOME, buildIds(BUILD_ID)],
];

/**
 * FlameComics' request layer: build-id rotation, and the coalescing that keeps
 * one screen from fetching the same payload several times.
 */
export function registerFlameNetworkTests(suite: TestSuite): void {
  suite.test("network: the discover sections share one homepage and one build id", async () => {
    const extension = new FlameComicsExtension();

    await withFakeNetwork(
      [
        ["/index.json", { body: HOMEPAGE }],
        [HOME, buildIds(BUILD_ID)],
      ],
      async (network) => {
        await Promise.all(
          SECTIONS.map((section) => extension.getDiscoverSectionItems(section, undefined)),
        );

        expect(network.count("/index.json"), "index.json").to.equal(1);
        expect(network.count(HOME), "build-id lookups").to.equal(1);
      },
    );
  });

  suite.test("network: opening a title fetches its series route once", async () => {
    const extension = new FlameComicsExtension();

    await withFakeNetwork(
      [
        [SERIES_ROUTE, { body: SERIES_DETAIL }],
        [HOME, buildIds(BUILD_ID)],
      ],
      async (network) => {
        await extension.getMangaDetails("1");
        await extension.getChapters(SOURCE_MANGA);

        expect(network.count(SERIES_ROUTE)).to.equal(1);
      },
    );
  });

  suite.test("network: a rotated build id is re-read and the request retried once", async () => {
    const extension = new FlameComicsExtension();

    await withFakeNetwork(
      [
        [`/${BUILD_ID}${SERIES_ROUTE}`, { status: 404, body: STALE_BUILD_PAYLOAD }],
        [`/${NEXT_BUILD_ID}${SERIES_ROUTE}`, { body: SERIES_DETAIL }],
        [HOME, buildIds(BUILD_ID, NEXT_BUILD_ID)],
      ],
      async (network) => {
        const manga = await extension.getMangaDetails("1");

        expect(manga.mangaId).to.equal("1");
        expect(network.count(HOME), "re-read once").to.equal(2);
        expect(network.count(SERIES_ROUTE), "stale, then fresh").to.equal(2);
      },
    );
  });

  suite.test("network: a missing series is not retried under a new build id", async () => {
    const extension = new FlameComicsExtension();

    await withFakeNetwork(
      [
        [SERIES_ROUTE, { status: 404, body: NOT_FOUND_PAYLOAD }],
        [HOME, buildIds(BUILD_ID, NEXT_BUILD_ID)],
      ],
      async (network) => {
        const error = await rejectionOf(extension.getMangaDetails("1"));

        expect(error.message).to.contain("does not exist");
        expect(network.count(HOME), "no id refresh").to.equal(1);
      },
    );
  });

  suite.test("network: an empty payload under an unchanged id fails without looping", async () => {
    const extension = new FlameComicsExtension();

    await withFakeNetwork(
      [
        [SERIES_ROUTE, { status: 404, body: STALE_BUILD_PAYLOAD }],
        [HOME, buildIds(BUILD_ID)],
      ],
      async (network) => {
        const error = await rejectionOf(extension.getMangaDetails("1"));

        expect(error.message).to.contain("empty payload");
        expect(network.count(SERIES_ROUTE), "one attempt, no retry").to.equal(1);
      },
    );
  });

  suite.test("catalog: a random sort keeps one order across pages", async () => {
    const extension = new FlameComicsExtension();
    const series = Array.from({ length: 250 }, (_, i) => makeSeries({ series_id: i + 1 }));
    const routes: RouteTable = [
      ["/latest.json", { body: { pageProps: { allSeries: series, keywordsMeta: "" } } }],
      [
        "/browse.json",
        {
          body: {
            pageProps: {
              series,
              initialFilters: { year: [], search: "", status: [], types: [], order: "desc" },
            },
          },
        },
      ],
      ["/api/series", { body: [] }],
      [HOME, buildIds(BUILD_ID)],
    ];
    const random = { id: "random", label: "Random" };

    await withFakeNetwork(routes, async () => {
      const seen: string[] = [];
      let metadata: Parameters<typeof extension.getSearchResults>[1];
      do {
        const page = await extension.getSearchResults({ title: "" }, metadata, random);
        seen.push(...page.items.map((item) => item.mangaId));
        metadata = page.metadata as typeof metadata;
      } while (metadata);

      expect(seen.length).to.equal(250);
      expect(new Set(seen).size, "no title repeats across pages").to.equal(250);
    });
  });

  suite.test("catalog: search and its form share one catalog load", async () => {
    const extension = new FlameComicsExtension();

    await withFakeNetwork(CATALOG_ROUTES, async (network) => {
      await Promise.all([
        extension.getAdvancedSearchForm({ title: "" }),
        extension.getSearchResults({ title: "" }, undefined, { id: "latest", label: "" }),
        extension.getSearchResults({ title: "" }, undefined, { id: "title_asc", label: "" }),
      ]);

      expect(network.count("/latest.json")).to.equal(1);
      expect(network.count("/browse.json")).to.equal(1);
      expect(network.count("/api/series")).to.equal(1);
    });
  });
}
