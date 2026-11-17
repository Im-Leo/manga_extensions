/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { SourceManga } from "@paperback/types";

import { TtlCache } from "../utils/cache";
import { resolveMangaId } from "./legacy";
import type {
  AggregateResponse,
  CoverSearchResponse,
  MangaDetailsResponse,
  StatisticsResponse,
} from "./models";
import { Status } from "./models";
import { fetchJSON } from "./network";
import { parseMangaDetails, readMangaDetailsSettings } from "./parsers";
import { getLanguages, getTryFirstVolumeCover } from "./state";
import {
  buildCoverSearchUrl,
  buildMangaAggregateUrl,
  buildMangaByIdUrl,
  buildStatisticsForMangaUrl,
} from "./urls";
import { isNotFoundError } from "./utils";

/**
 * A title opening asks for details and then chapters, and with Auto-Update Metadata on the chapter
 * read fetches details again; the cache gives both one set of requests.
 */
const DETAILS_TTL_MS = 30 * 1000;
const detailsCache = new TtlCache<string, SourceManga>(DETAILS_TTL_MS, 8);

export async function getMangaDetails(mangaId: string): Promise<SourceManga> {
  const details = await detailsCache.get(await resolveMangaId(mangaId), fetchMangaDetails);
  // Callers merge into mangaInfo, so each gets its own rather than the cached object.
  return { ...details, mangaInfo: { ...details.mangaInfo } };
}

async function fetchMangaDetails(resolvedId: string): Promise<SourceManga> {
  const detailsRequest = {
    url: buildMangaByIdUrl(resolvedId, ["author", "artist", "cover_art"]).toString(),
    method: "GET",
  };

  const statisticsRequest = {
    url: buildStatisticsForMangaUrl(resolvedId).toString(),
    method: "GET",
  };

  const tryFirstVolumeCover = getTryFirstVolumeCover();
  // A batch, because covers with a null volume sort first; the pick happens below.
  const coverRequest = tryFirstVolumeCover
    ? {
        url: buildCoverSearchUrl({ mangaId: resolvedId, limit: 10, orderVolume: "asc" }).toString(),
        method: "GET",
      }
    : undefined;

  const [detailsResult, statsResult, coverResult] = await Promise.allSettled([
    fetchJSON<MangaDetailsResponse>(detailsRequest),
    fetchJSON<StatisticsResponse>(statisticsRequest),
    coverRequest
      ? fetchJSON<CoverSearchResponse>(coverRequest)
      : Promise.resolve(undefined as CoverSearchResponse | undefined),
  ]);

  if (detailsResult.status === "rejected") {
    const reason = detailsResult.reason;
    if (isNotFoundError(reason)) {
      const msg = reason instanceof Error ? reason.message : String(reason);
      throw new Error(`${msg}. You may need to add this manga again`);
    }
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  const json = detailsResult.value;
  if (!json.data) {
    throw new Error(`MangaDex API Error: missing data field for ${resolvedId}`);
  }

  // Only a completed title needs the aggregate, to check its final chapter is uploaded. Asked for
  // after the status is known: one extra round trip for those titles, one request fewer for the rest.
  const aggregateJson: AggregateResponse | undefined =
    json.data.attributes?.status === Status.Completed
      ? await fetchJSON<AggregateResponse>({
          url: buildMangaAggregateUrl(resolvedId, getLanguages()).toString(),
          method: "GET",
        }).catch(() => undefined)
      : undefined;

  const ratingJson: StatisticsResponse | undefined =
    statsResult.status === "fulfilled" ? statsResult.value : undefined;

  const coverJson: CoverSearchResponse | undefined =
    coverResult.status === "fulfilled" ? coverResult.value : undefined;
  const coverFileNameOverride = coverJson?.data?.find(
    (c) =>
      c?.attributes?.volume !== null &&
      c?.attributes?.volume !== undefined &&
      c?.attributes?.volume !== "",
  )?.attributes?.fileName;

  return parseMangaDetails(
    resolvedId,
    json,
    ratingJson,
    readMangaDetailsSettings(),
    aggregateJson,
    coverFileNameOverride,
  );
}
