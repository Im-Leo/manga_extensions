/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { SourceManga, UpdateManager } from "@paperback/types";
import { expect } from "chai";

import { LATEST_CHAPTER_INFO_KEY, Status } from "../MangaDex/models.js";
import { resetAllSettings } from "../MangaDex/state/reset.js";
import {
  setOptimizeUpdates,
  setSkipPublicationStatus,
  setSkipUnreadChapters,
} from "../MangaDex/state/updates.js";
import { processTitlesForUpdates } from "../MangaDex/updates.js";
import { withFakeNetwork } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";
const GAMMA = "33333333-3333-4333-8333-333333333333";
const LEGACY_ID = "48213";

interface StoredTitle {
  mangaId: string;
  status?: Status;
  unread?: number;
  latestChapter?: string;
}

function stored({ mangaId, status, unread = 0, latestChapter }: StoredTitle): SourceManga {
  return {
    mangaId,
    mangaInfo: {
      primaryTitle: mangaId,
      status,
      additionalInfo: latestChapter ? { [LATEST_CHAPTER_INFO_KEY]: latestChapter } : {},
    },
    chapterCount: 10,
    unreadChapterCount: unread,
    newChapterCount: 0,
  } as unknown as SourceManga;
}

/** Records which titles the flow told the app to skip. */
function updateManager(queued: SourceManga[]): { manager: UpdateManager; skipped: string[] } {
  const skipped: string[] = [];
  const manager = {
    getQueuedItems: () => queued,
    setNewChapters: async (mangaId: string) => {
      skipped.push(mangaId);
    },
  } as unknown as UpdateManager;
  return { manager, skipped };
}

/** The library-update flow: which titles are skipped, and under which id. */
export function registerMangaDexUpdateTests(suite: TestSuite): void {
  suite.test("updates: skip filters apply with Optimized Updates off", async () => {
    resetAllSettings();
    try {
      setOptimizeUpdates(false);
      setSkipUnreadChapters(1);
      setSkipPublicationStatus([Status.Completed]);
      const { manager, skipped } = updateManager([
        stored({ mangaId: ALPHA, status: Status.Ongoing, unread: 3 }),
        stored({ mangaId: BETA, status: Status.Ongoing }),
        stored({ mangaId: GAMMA, status: Status.Completed }),
      ]);

      // No routes: with batching off, filtering needs nothing but stored state.
      await withFakeNetwork([], () => processTitlesForUpdates(manager));

      expect([...skipped].sort()).to.deep.equal([ALPHA, GAMMA].sort());
    } finally {
      resetAllSettings();
    }
  });

  suite.test("updates: the batch check is not narrowed by language", async () => {
    resetAllSettings();
    try {
      setOptimizeUpdates(true);
      const { manager } = updateManager([stored({ mangaId: ALPHA, latestChapter: "chapter-1" })]);
      const unchanged = {
        data: [
          { id: ALPHA, attributes: { status: Status.Ongoing, latestUploadedChapter: "chapter-1" } },
        ],
      };

      await withFakeNetwork([["/manga?", { body: unchanged }]], async (network) => {
        await processTitlesForUpdates(manager);

        expect(network.requests).to.have.lengthOf(1);
        expect(
          decodeURIComponent(network.requests[0]?.url ?? ""),
          "a title without chapters in the user's languages must not drop out and cost a request",
        ).to.not.contain("availableTranslatedLanguage");
      });
    } finally {
      resetAllSettings();
    }
  });

  suite.test("updates: a legacy id is skipped under the id the app queued", async () => {
    resetAllSettings();
    try {
      setOptimizeUpdates(true);
      const { manager, skipped } = updateManager([
        stored({ mangaId: LEGACY_ID, status: Status.Ongoing, latestChapter: "chapter-1" }),
      ]);
      const mapping = {
        data: [{ attributes: { legacyId: Number(LEGACY_ID), newId: ALPHA } }],
      };
      const unchanged = {
        data: [
          {
            id: ALPHA,
            attributes: { status: Status.Ongoing, latestUploadedChapter: "chapter-1" },
          },
        ],
      };

      await withFakeNetwork(
        [
          ["/legacy/mapping", { body: mapping }],
          ["/manga?", { body: unchanged }],
        ],
        () => processTitlesForUpdates(manager),
      );

      expect(skipped).to.deep.equal([LEGACY_ID]);
    } finally {
      resetAllSettings();
    }
  });
}
