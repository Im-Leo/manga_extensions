/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { SourceManga, UpdateManager } from "@paperback/types";

import { fetchLatestUploadedChapter } from "./chapter-feed";
import { resolveMangaIds } from "./legacy";
import { LATEST_CHAPTER_INFO_KEY } from "./models";
import type { SearchResponse } from "./models";
import { fetchJSON } from "./network";
import { reconcileStoredCompletedStatus } from "./parsers";
import {
  getLanguages,
  getOptimizeUpdates,
  getRatings,
  getSkipNewChapters,
  getSkipPublicationStatus,
  getSkipUnreadChapters,
  getUpdateBatchSize,
} from "./state";
import { buildMangaListUrl } from "./urls";
import { isNotFoundError, shouldSkipByCount } from "./utils";

/**
 * The library-update flow.
 *
 * Paperback asks for every followed title at once, so this batches the requests
 * and skips titles whose stored high-water chapter has not moved — the check
 * that keeps a routine update from costing one request per title.
 */

export async function processTitlesForUpdates(
  updateManager: UpdateManager,
  _lastUpdateDate?: Date,
): Promise<void> {
  const queued = updateManager.getQueuedItems();
  const idMap = await resolveMangaIds(queued.map((m) => m.mangaId));

  // The app tracks a title by the id it queued, which for an old library entry is a legacy
  // numeric id; requests use the resolved UUID, and answers go back under the queued id.
  const queuedIdOf = new Map<string, string>();
  const mangaMap = new Map<string, SourceManga>();
  const mangaIds: string[] = [];
  const unresolved: string[] = [];
  for (const manga of queued) {
    const resolved = idMap[manga.mangaId];
    if (!resolved) {
      unresolved.push(manga.mangaId);
      continue;
    }
    queuedIdOf.set(resolved, manga.mangaId);
    mangaIds.push(resolved);
    mangaMap.set(resolved, manga);
  }

  const skip = (ids: string[]) =>
    Promise.all(ids.map((id) => updateManager.setNewChapters(queuedIdOf.get(id) ?? id, [])));
  await skip(unresolved);

  const optimizeUpdates = getOptimizeUpdates();

  if (optimizeUpdates) {
    const ratings: string[] = getRatings();
    const languages: string[] = getLanguages();
    const skipPublicationStatus = getSkipPublicationStatus();
    const batchSize = getUpdateBatchSize();
    const skipNewChapters = getSkipNewChapters();
    const skipUnreadChapters = getSkipUnreadChapters();

    for (let i = 0; i < mangaIds.length; i += batchSize) {
      const batchIds = mangaIds.slice(i, i + batchSize);
      const idsToSkip: string[] = [];

      const request = {
        url: buildMangaListUrl({
          limit: batchSize,
          languages,
          ratings,
          ids: batchIds,
          includes: [],
        }).toString(),
        method: "GET",
      };

      let json: SearchResponse;
      try {
        json = await fetchJSON<SearchResponse>(request);
      } catch {
        continue;
      }

      const seenIds = new Set<string>();
      if (Array.isArray(json.data)) {
        for (const mangaData of json.data) {
          if (!mangaData || !mangaData.attributes) continue;
          const apiId = mangaData.id.toLowerCase();
          seenIds.add(apiId);
          const storedManga = mangaMap.get(apiId);
          if (!storedManga) continue;

          const latestApiChapter = mangaData.attributes.latestUploadedChapter;
          const latestStoredChapter =
            storedManga.mangaInfo?.additionalInfo?.[LATEST_CHAPTER_INFO_KEY];
          const chapterChanged = (latestApiChapter ?? null) !== (latestStoredChapter ?? null);

          const skipUnread = shouldSkipByCount(
            skipUnreadChapters,
            storedManga.unreadChapterCount,
            storedManga.chapterCount,
          );
          const skipNew = shouldSkipByCount(
            skipNewChapters,
            storedManga.newChapterCount,
            storedManga.chapterCount,
          );
          const effectiveStatus = reconcileStoredCompletedStatus(
            mangaData.attributes.status,
            storedManga.mangaInfo?.status,
          );
          const filterSkip =
            skipPublicationStatus.includes(effectiveStatus) || skipUnread || skipNew;

          if (!chapterChanged || filterSkip) {
            idsToSkip.push(apiId);
          }
        }
      }

      const missingIds = batchIds.filter((id) => !seenIds.has(id));
      const VERIFY_MISSING_THRESHOLD = 10;
      if (missingIds.length > 0 && missingIds.length <= VERIFY_MISSING_THRESHOLD) {
        const verifyResults = await Promise.allSettled(
          missingIds.map((mangaId) => fetchLatestUploadedChapter(mangaId)),
        );
        for (const [k, result] of verifyResults.entries()) {
          const mangaId = missingIds[k];
          if (!mangaId) continue;

          if (result.status === "fulfilled") {
            const stored = mangaMap.get(mangaId);
            const latestStored =
              stored?.mangaInfo?.additionalInfo?.[LATEST_CHAPTER_INFO_KEY] ?? null;
            if (result.value === null || result.value === latestStored) {
              idsToSkip.push(mangaId);
            }
            continue;
          }

          if (isNotFoundError(result.reason)) {
            idsToSkip.push(mangaId);
          }
        }
      } else if (missingIds.length > VERIFY_MISSING_THRESHOLD) {
        idsToSkip.push(...missingIds);
      }

      await skip(idsToSkip);
    }
  }
}
