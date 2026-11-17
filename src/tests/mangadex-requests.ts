/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { expect } from "chai";

import { getDiscoverSectionItems } from "../MangaDex/discover.js";
import { getMangaDetails } from "../MangaDex/manga.js";
import { getSearchResults } from "../MangaDex/search.js";
import { saveBlockedGroups, setGroupBlockingEnabled } from "../MangaDex/state/blocking.js";
import { DISCOVER_SECTIONS } from "../MangaDex/state/discover.js";
import { resetAllSettings } from "../MangaDex/state/reset.js";
import { MANGA_PAGE_LIMIT } from "../MangaDex/utils.js";
import { withFakeNetwork } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";
const GAMMA = "33333333-3333-4333-8333-333333333333";
const GROUP = "44444444-4444-4444-8444-444444444444";
const EMPTY_LIST = { body: { data: [], total: 0, limit: 0, offset: 0 } };

/** A full page of chapters, so paging continues, cycling through `mangaIds`. */
function chapterPage(prefix: string, mangaIds: string[]) {
  return {
    body: {
      data: Array.from({ length: MANGA_PAGE_LIMIT }, (_, i) => ({
        id: `${prefix}${i}`,
        attributes: { chapter: "1", readableAt: "2026-01-01T00:00:00Z" },
        relationships: [{ id: mangaIds[i % mangaIds.length], type: "manga" }],
      })),
      total: 10 * MANGA_PAGE_LIMIT,
    },
  };
}

function mangaList(ids: string[]) {
  return {
    body: { data: ids.map((id) => ({ id, type: "manga", attributes: {}, relationships: [] })) },
  };
}

function mangaIdsOf(items: readonly unknown[]): string[] {
  return items.map((item) => (item as { mangaId: string }).mangaId);
}

/** A title as `/manga/{id}` returns it, with only what the details parser reads. */
function mangaDetails(id: string, status: string) {
  return {
    body: {
      result: "ok",
      data: {
        id,
        type: "manga",
        attributes: {
          title: { en: "Title" },
          altTitles: [],
          description: { en: "" },
          status,
          contentRating: "safe",
          tags: [],
          links: {},
          originalLanguage: "ja",
          lastChapter: "10",
          lastVolume: "",
        },
        relationships: [],
      },
    },
  };
}

const DETAIL_ROUTES = (id: string, status: string) =>
  [
    [`/manga/${id}/aggregate`, { body: { result: "ok", volumes: {} } }],
    [`/manga/${id}?`, mangaDetails(id, status)],
    [`/statistics/manga/${id}`, { body: { result: "ok", statistics: {} } }],
    ["/cover?", { body: { data: [] } }],
  ] as const;

/** What MangaDex asks the API for, checked from the requests a flow actually makes. */
export function registerMangaDexRequestTests(suite: TestSuite): void {
  suite.test(
    "discover: Latest Updates leaves out blocked groups only while blocking is on",
    async () => {
      const latest = { id: DISCOVER_SECTIONS.LATEST_UPDATES, title: "Latest", type: 0 } as never;
      const requestedUrl = async () =>
        withFakeNetwork([["/chapter?", EMPTY_LIST]], async (network) => {
          await getDiscoverSectionItems(latest, undefined);
          return decodeURIComponent(network.requests[0]?.url ?? "");
        });

      resetAllSettings();
      try {
        saveBlockedGroups({ [GROUP]: { id: GROUP } as never });
        expect(await requestedUrl(), "blocking off").to.not.contain("excludedGroups");

        setGroupBlockingEnabled(true);
        expect(await requestedUrl()).to.contain(`excludedGroups[]=${GROUP}`);
      } finally {
        resetAllSettings();
      }
    },
  );

  suite.test("discover: Latest Updates shows each title once across pages", async () => {
    const latest = { id: DISCOVER_SECTIONS.LATEST_UPDATES, title: "Latest", type: 0 } as never;

    await withFakeNetwork(
      [
        [/chapter\?.*offset=0&/, chapterPage("a", [ALPHA, BETA])],
        [/chapter\?/, chapterPage("b", [BETA, GAMMA])],
        [
          "/manga?",
          (request) => mangaList([ALPHA, BETA, GAMMA].filter((id) => request.url.includes(id))),
        ],
      ],
      async () => {
        const first = await getDiscoverSectionItems(latest, undefined);
        const second = await getDiscoverSectionItems(latest, first.metadata as never);

        expect(mangaIdsOf(first.items)).to.deep.equal([ALPHA, BETA]);
        expect(mangaIdsOf(second.items), "BETA was already shown").to.deep.equal([GAMMA]);
      },
    );
  });

  suite.test("details: a title opening fetches its details once", async () => {
    const id = "55555555-5555-4555-8555-555555555555";
    await withFakeNetwork(DETAIL_ROUTES(id, "ongoing"), async (network) => {
      const [first, second] = await Promise.all([getMangaDetails(id), getMangaDetails(id)]);

      expect(network.count(`/manga/${id}?`)).to.equal(1);
      expect(first.mangaInfo, "each caller may change its own copy").to.not.equal(second.mangaInfo);
    });
  });

  suite.test("details: the chapter aggregate is requested only for completed titles", async () => {
    const ongoing = "66666666-6666-4666-8666-666666666666";
    const completed = "77777777-7777-4777-8777-777777777777";
    await withFakeNetwork(
      [...DETAIL_ROUTES(ongoing, "ongoing"), ...DETAIL_ROUTES(completed, "completed")],
      async (network) => {
        await getMangaDetails(ongoing);
        await getMangaDetails(completed);

        expect(network.count(`/manga/${ongoing}/aggregate`), "ongoing").to.equal(0);
        expect(network.count(`/manga/${completed}/aggregate`), "completed").to.equal(1);
      },
    );
  });

  suite.test("search: an exact id lookup ignores the language filter", async () => {
    await withFakeNetwork([["/manga?", EMPTY_LIST]], async (network) => {
      await getSearchResults({ title: ALPHA }, undefined, undefined);

      const url = decodeURIComponent(network.requests[0]?.url ?? "");
      expect(url).to.contain(`ids[]=${ALPHA}`);
      expect(url, "a pasted title is found whatever its languages").to.not.contain(
        "availableTranslatedLanguage",
      );
    });
  });

  suite.test("search: the author field accepts a pasted link", async () => {
    await withFakeNetwork([["/manga?", EMPTY_LIST]], async (network) => {
      const link = `https://mangadex.org/author/${GROUP.toUpperCase()}/some-author`;
      await getSearchResults(
        { title: "", metadata: { authorOrArtist: link } },
        undefined,
        undefined,
      );

      expect(decodeURIComponent(network.requests[0]?.url ?? "")).to.contain(
        `authorOrArtist=${GROUP}`,
      );
    });
  });

  suite.test("search: a title search keeps the language filter", async () => {
    await withFakeNetwork([["/manga?", EMPTY_LIST]], async (network) => {
      await getSearchResults({ title: "frieren" }, undefined, undefined);

      const url = decodeURIComponent(network.requests[0]?.url ?? "");
      expect(url).to.contain("availableTranslatedLanguage");
      expect(url).to.contain("title=frieren");
      expect(url, "a title search is not an id lookup").to.not.contain("ids[]");
    });
  });
}
