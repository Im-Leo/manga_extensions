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
  const unresolved: string[] = [];
  for (const manga of queued) {
    const resolved = idMap[manga.mangaId];
    if (!resolved) {
      unresolved.push(manga.mangaId);
      continue;
    }
    queuedIdOf.set(resolved, manga.mangaId);
    mangaMap.set(resolved, manga);
  }

  const skip = (ids: string[]) =>
    Promise.all(ids.map((id) => updateManager.setNewChapters(queuedIdOf.get(id) ?? id, [])));
  await skip(unresolved);

  const optimizeUpdates = getOptimizeUpdates();
  const skipPublicationStatus = getSkipPublicationStatus();
  const skipNewChapters = getSkipNewChapters();
  const skipUnreadChapters = getSkipUnreadChapters();

  const filteredOut = (manga: SourceManga, status: string | undefined): boolean =>
    (status !== undefined && skipPublicationStatus.includes(status)) ||
    shouldSkipByCount(skipUnreadChapters, manga.unreadChapterCount, manga.chapterCount) ||
    shouldSkipByCount(skipNewChapters, manga.newChapterCount, manga.chapterCount);

  // The filters need only what the app stored, so they apply whether or not updates are batched.
  // Batching reads the fresher status from the API instead, below.
  const candidates: string[] = [];
  const filtered: string[] = [];
  for (const [mangaId, manga] of mangaMap) {
    const storedStatus = optimizeUpdates ? undefined : manga.mangaInfo?.status;
    (filteredOut(manga, storedStatus) ? filtered : candidates).push(mangaId);
  }
  await skip(filtered);

  if (!optimizeUpdates) return;

  const ratings: string[] = getRatings();
  const batchSize = getUpdateBatchSize();

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batchIds = candidates.slice(i, i + batchSize);
    const idsToSkip: string[] = [];

    const request = {
      // No language filter: latestUploadedChapter spans every language anyway, and a title without
      // chapters in the user's languages would drop out and cost a request of its own below.
      url: buildMangaListUrl({
        limit: batchSize,
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
        const effectiveStatus = reconcileStoredCompletedStatus(
          mangaData.attributes.status,
          storedManga.mangaInfo?.status,
        );

        if (!chapterChanged || filteredOut(storedManga, effectiveStatus)) {
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
          const latestStored = stored?.mangaInfo?.additionalInfo?.[LATEST_CHAPTER_INFO_KEY] ?? null;
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
