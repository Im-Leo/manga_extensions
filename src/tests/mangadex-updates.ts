/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { SourceManga, UpdateManager } from "@paperback/types";
import { expect } from "chai";

import { LATEST_CHAPTER_INFO_KEY, Status } from "../MangaDex/models.js";
import { resetAllSettings } from "../MangaDex/state/reset.js";
import { setOptimizeUpdates } from "../MangaDex/state/updates.js";
import { processTitlesForUpdates } from "../MangaDex/updates.js";
import { withFakeNetwork } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

const ALPHA = "11111111-1111-4111-8111-111111111111";
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
