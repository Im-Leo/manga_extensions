/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type {
  ChapterReadActionQueueProcessingResult,
  MangaProgress,
  SourceManga,
  TrackedMangaChapterReadAction,
} from "@paperback/types";

import { HttpError, fetchJSON, fetchResponse, isSuccessStatus } from "../utils/network";
import type { AsuraBookmark, AsuraBookmarkResponse, AsuraScansReadingStatus } from "./models";
import { isSignedIn, requireAccessToken } from "./session";
import { bookmarkReadUrl, bookmarkSearchUrl, bookmarkUrl } from "./urls";

/** Reading progress, which the API stores against a bookmark. */

export interface BookmarkProgress {
  status: AsuraScansReadingStatus;
  last_read_chapter: number;
}

async function authorization(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await requireAccessToken()}` };
}

async function send(url: string, method: "POST" | "PUT", payload?: object): Promise<void> {
  const headers = await authorization();
  const { response } = await fetchResponse({
    url,
    method,
    headers: payload ? { ...headers, "Content-Type": "application/json" } : headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  if (!isSuccessStatus(response.status)) throw new HttpError(response.status, url);
}

/** The numeric series id the bookmark endpoints address; the slug is not accepted there. */
export function seriesIdOf(sourceManga: SourceManga): string {
  const id = sourceManga.mangaInfo.additionalInfo?.["id"];
  if (!id) {
    throw new Error(
      `AsuraScans: ${sourceManga.mangaId} has no series id. Refresh the title and try again.`,
    );
  }
  return id;
}

/** Search matches by title, so the slug decides which result is really this series. */
export async function findBookmark(sourceManga: SourceManga): Promise<AsuraBookmark | undefined> {
  const bookmarks = await fetchJSON<AsuraBookmarkResponse>({
    url: bookmarkSearchUrl(sourceManga.mangaInfo.primaryTitle),
    method: "GET",
    headers: await authorization(),
  });

  return bookmarks.data.find((bookmark) => bookmark.series.slug === sourceManga.mangaId);
}

export async function createBookmark(seriesId: string): Promise<void> {
  await send(bookmarkUrl(seriesId), "POST");
}

export async function updateBookmark(seriesId: string, progress: BookmarkProgress): Promise<void> {
  await send(bookmarkUrl(seriesId), "PUT", progress);
}

export async function getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress> {
  const bookmark = await findBookmark(sourceManga);
  if (!bookmark) throw new Error("AsuraScans: this title is not in your bookmarks.");

  return {
    sourceManga,
    lastReadChapter: {
      chapterId: bookmark.last_read_chapter.toString(),
      sourceManga,
      volume: 0,
      langCode: "en",
      chapNum: bookmark.last_read_chapter,
    },
    lastReadTime: new Date(bookmark.last_read_at),
    userRating: 0,
  };
}

/**
 * Signed out, nothing is acknowledged either way, so the queue keeps the actions
 * and syncs them once the user signs in.
 */
export async function processChapterReadActionQueue(
  actions: TrackedMangaChapterReadAction[],
): Promise<ChapterReadActionQueueProcessingResult> {
  const result: ChapterReadActionQueueProcessingResult = {
    successfulItems: [],
    failedItems: [],
  };

  if (!isSignedIn()) return result;

  // The API stores one high-water mark per title, so only the furthest chapter
  // needs sending; earlier actions in the queue are acknowledged untouched.
  const furthest = new Map<string, number>();
  for (const action of actions) {
    const mangaId = action.sourceManga.mangaId;
    if ((furthest.get(mangaId) ?? 0) < action.chapterNum) furthest.set(mangaId, action.chapterNum);
  }

  for (const action of actions) {
    if (furthest.get(action.sourceManga.mangaId) !== action.chapterNum) {
      result.successfulItems.push(action.id);
      continue;
    }

    try {
      const seriesId = seriesIdOf(action.sourceManga);
      const bookmark = await findBookmark(action.sourceManga);

      if (bookmark && bookmark.last_read_chapter >= action.chapterNum) {
        result.successfulItems.push(action.id);
        continue;
      }

      // Progress can only be recorded against a bookmark that already exists.
      if (!bookmark) await createBookmark(seriesId);
      await send(bookmarkReadUrl(seriesId, action.chapterNum), "POST");

      result.successfulItems.push(action.id);
    } catch {
      result.failedItems.push(action.id);
    }
  }

  return result;
}
