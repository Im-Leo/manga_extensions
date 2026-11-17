/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type {
  ManagedCollection,
  ManagedCollectionChange,
  ManagedCollectionChangeFailure,
  ManagedCollectionItems,
  SourceManga,
} from "@paperback/types";

import { JSON_HEADERS } from "../utils/network";
import { resolveMangaId } from "./legacy";
import { getRatingEnumList } from "./lookups";
import type { MangaStatusResponse, SearchResponse } from "./models";
import { fetchJSON } from "./network";
import { parseMangaDetails, readMangaDetailsSettings } from "./parsers";
import { getAccessToken } from "./state";
import { buildMangaListUrl, buildMangaStatusListUrl, buildMangaStatusWriteUrl } from "./urls";
import { MANGA_PAGE_LIMIT, chunk } from "./utils";

/**
 * MangaDex reading statuses surfaced as Paperback managed collections, so a
 * title filed on either side stays in step.
 */

const SIGN_IN_REQUIRED = "MangaDex: sign in to sync your library.";

/** A title has exactly one reading status, so the collections exclude each other. */
const STATUS_GROUP = "reading-status";

const COLLECTIONS: readonly ManagedCollection[] = [
  ["reading", "Reading"],
  ["on_hold", "On Hold"],
  ["plan_to_read", "Planned"],
  ["dropped", "Dropped"],
  ["re_reading", "Re-reading"],
  ["completed", "Completed"],
].map(([id = "", title = ""]) => ({ id, title, exclusiveGroup: STATUS_GROUP }));

export async function getManagedCollections(): Promise<ManagedCollection[]> {
  return [...COLLECTIONS];
}

/** One status request and one set of detail requests, however many collections are asked for. */
export async function getManagedCollectionItems(
  collections: ManagedCollection[],
): Promise<ManagedCollectionItems[]> {
  if (!getAccessToken()) throw new Error(SIGN_IN_REQUIRED);

  const statuses = await fetchStatuses();
  const requested = new Set(collections.map((collection) => collection.id));
  const ids = Object.keys(statuses).filter((id) => requested.has(statuses[id] ?? ""));
  const manga = new Map((await fetchManga(ids)).map((item) => [item.mangaId, item]));

  return collections.map((collection) => ({
    collectionId: collection.id,
    items: ids.filter((id) => statuses[id] === collection.id).flatMap((id) => manga.get(id) ?? []),
  }));
}

/**
 * Each change is applied on its own and its failure reported by id; the call
 * throws only when nothing could be applied, as the app expects.
 */
export async function applyManagedCollectionChanges(
  changes: ManagedCollectionChange[],
): Promise<ManagedCollectionChangeFailure[]> {
  if (!getAccessToken()) throw new Error(SIGN_IN_REQUIRED);

  const outcomes = await Promise.all(
    changes.map(async (change): Promise<ManagedCollectionChangeFailure | undefined> => {
      try {
        await writeStatus(
          change.sourceManga.mangaId,
          change.type === "remove" ? null : change.to.id,
        );
        return undefined;
      } catch (error) {
        return {
          changeId: change.id,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const failures = outcomes.filter((failure) => failure !== undefined);
  if (changes.length > 0 && failures.length === changes.length) {
    throw new Error(
      `MangaDex: no library change could be saved. ${failures[0]?.reason ?? ""}`.trim(),
    );
  }
  return failures;
}

async function writeStatus(mangaId: string, status: string | null): Promise<void> {
  await fetchJSON<{ result?: string }>({
    url: buildMangaStatusWriteUrl(await resolveMangaId(mangaId)).toString(),
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ status }),
  });
}

async function fetchStatuses(): Promise<Record<string, string>> {
  const response = await fetchJSON<MangaStatusResponse>({
    url: buildMangaStatusListUrl().toString(),
    method: "GET",
  });

  if (
    !response.statuses ||
    typeof response.statuses !== "object" ||
    Array.isArray(response.statuses)
  ) {
    throw new Error("MangaDex returned no status data");
  }
  return response.statuses;
}

async function fetchManga(ids: string[]): Promise<SourceManga[]> {
  const responses = await Promise.all(
    chunk(ids, MANGA_PAGE_LIMIT).map((batch) =>
      fetchJSON<SearchResponse>({
        url: buildMangaListUrl({
          limit: MANGA_PAGE_LIMIT,
          ratings: getRatingEnumList(),
          includes: ["author", "artist", "cover_art"],
          ids: batch,
        }).toString(),
        method: "GET",
      }),
    ),
  );

  const detailsSettings = readMangaDetailsSettings();

  return responses.flatMap((json) =>
    Array.isArray(json.data)
      ? json.data.map((item) =>
          parseMangaDetails(
            item.id,
            { result: "ok", response: "entity", data: item },
            undefined,
            detailsSettings,
          ),
        )
      : [],
  );
}
