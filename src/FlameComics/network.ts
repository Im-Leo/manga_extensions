/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { TtlCache } from "../utils/cache";
import { fetchJSON, fetchResponse, fetchText } from "../utils/network";
import { dataUrl, homeUrl, simpleSeriesUrl } from "./urls";

/**
 * Access to the `_next/data` routes, whose paths embed a build id that changes
 * whenever the site redeploys.
 *
 * The routes signal failure in the response body rather than by status, so every
 * fetch here has to inspect what it parsed: a rotated build id and a deleted
 * series both arrive as HTTP 404 carrying valid JSON, and only the first is
 * worth retrying.
 */

/** The id only changes on redeploy, so a stale cache costs at most one retry. */
const BUILD_ID_TTL_MS = 6 * 60 * 60 * 1000;

const BUILD_ID_KEY = "current";

/** The one failure a retry can fix. Everything else answers the same under a new id. */
class StaleBuildIdError extends Error {}

/**
 * The wrapper every `_next/data` response arrives in, including its failures:
 *
 *     stale build id  ->  `{"__N_SSG":true,"pageProps":{}}`   retry under a new id
 *     missing series  ->  `{"notFound":true}`                 no id will help
 *
 * Both parse cleanly, so without inspecting them a stale id yields silently
 * empty sections and a missing series throws deep inside a parser.
 */
interface NextDataEnvelope {
  pageProps?: Record<string, unknown>;
  notFound?: boolean;
}

async function fetchBuildId(): Promise<string> {
  const html = await fetchText(homeUrl());
  const buildId = /"buildId":"([^"]+)"/.exec(html)?.[1];

  if (!buildId) {
    throw new Error("FlameComics: no buildId found on the homepage; the site layout changed.");
  }

  return buildId;
}

async function fetchPayload<T>(
  id: string,
  segments: string[],
  query?: Record<string, string>,
): Promise<T> {
  const path = segments.join("/");
  const { body } = await fetchResponse(dataUrl(id, segments, query));

  let payload: T & NextDataEnvelope;
  try {
    payload = JSON.parse(body) as T & NextDataEnvelope;
  } catch {
    // Not JSON at all: the data route did not match, which a rotated id explains.
    throw new StaleBuildIdError(`FlameComics: unparseable payload for ${path}`);
  }

  if (payload.notFound) {
    throw new Error(
      `FlameComics: ${path} does not exist on the site. ` +
        `If this title is in your library it predates a site renumbering — ` +
        `remove it from the library and re-add it from search.`,
    );
  }

  if (!payload.pageProps || Object.keys(payload.pageProps).length === 0) {
    throw new StaleBuildIdError(`FlameComics: empty payload for ${path}`);
  }

  return payload;
}

/**
 * Reads `_next/data` routes under the current build id.
 *
 * The id is held per instance and its lookup is shared, so the discover sections
 * loading together on launch cost one homepage request between them.
 */
export class NextDataClient {
  private readonly buildIds = new TtlCache<string, string>(BUILD_ID_TTL_MS, 1);

  async fetch<T>(segments: string[], query?: Record<string, string>): Promise<T> {
    const id = await this.buildIds.get(BUILD_ID_KEY, fetchBuildId);

    try {
      return await fetchPayload<T>(id, segments, query);
    } catch (error) {
      if (!(error instanceof StaleBuildIdError)) throw error;

      this.buildIds.delete(BUILD_ID_KEY);
      const fresh = await this.buildIds.get(BUILD_ID_KEY, fetchBuildId);
      // Same id means the payload was not stale after all; retrying would repeat it.
      if (fresh === id) throw error;

      return fetchPayload<T>(fresh, segments, query);
    }
  }
}

/** `/api/series` is a plain REST route: no envelope, and immune to id rotation. */
export async function fetchSimpleSeries<T>(): Promise<T> {
  return fetchJSON<T>(simpleSeriesUrl());
}
