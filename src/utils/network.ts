/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { Request, Response } from "@paperback/types";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";

/**
 * Request helpers shared by every source.
 *
 * Going through `Application.scheduleRequest` is the point: it is the only path
 * that passes registered interceptors, so a source's `Referer` and rate limit
 * apply to every call made here.
 *
 * The readers fail loudly. An error page that parses, or a body that is not the
 * expected JSON, would otherwise reach the app as an empty shelf or an empty
 * chapter list, which reads as "the site has nothing" rather than "retry".
 */

export type RequestInput = string | Request;

export const JSON_MEDIA_TYPE = "application/json";

/** Headers for a request carrying a JSON body. */
export const JSON_HEADERS: Readonly<Record<string, string>> = { "Content-Type": JSON_MEDIA_TYPE };

/** Endpoint without its query, so an error names the route rather than every parameter. */
function endpoint(url: string): string {
  return url.split("?")[0] ?? url;
}

/** A response whose status says the request failed, whatever its body contains. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`Request failed with status ${status}: ${endpoint(url)}`);
    this.name = "HttpError";
  }
}

/** A successful response whose body is not the format the caller asked for. */
export class InvalidResponseError extends Error {
  constructor(readonly url: string) {
    super(`Unexpected response format from ${endpoint(url)}`);
    this.name = "InvalidResponseError";
  }
}

/** 2xx, plus the 304 a conditional request earns when the cached copy still stands. */
export function isSuccessStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 304;
}

/** HTTP header names are case-insensitive, and the runtime preserves whatever case the server sent. */
export function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

export interface TextResponse {
  readonly response: Response;
  readonly body: string;
}

/** Status-agnostic, for routes that report failure in the body rather than the status. */
export async function fetchResponse(input: RequestInput): Promise<TextResponse> {
  const request = typeof input === "string" ? { url: input, method: "GET" } : input;
  const [response, buffer] = await Application.scheduleRequest(request);
  return { response, body: Application.arrayBufferToUTF8String(buffer) };
}

export async function fetchText(input: RequestInput): Promise<string> {
  const { response, body } = await fetchResponse(input);
  if (!isSuccessStatus(response.status)) {
    throw new HttpError(response.status, typeof input === "string" ? input : input.url);
  }
  return body;
}

export async function fetchCheerio(input: RequestInput): Promise<CheerioAPI> {
  return cheerio.load(await fetchText(input));
}

/**
 * A title page answering 404 means the site removed the series, typically after it was licensed.
 * That is reported in words the user can act on: the title will not come back on this source, so
 * it has to be migrated.
 */
export async function fetchTitlePage(
  url: string,
  source: string,
  site: string,
): Promise<CheerioAPI> {
  try {
    return await fetchCheerio(url);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new Error(
        `${source}: this title is no longer on ${site}; it was removed or renamed. ` +
          `Migrate it to another source.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function fetchJSON<T>(input: RequestInput): Promise<T> {
  const body = await fetchText(input);

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new InvalidResponseError(typeof input === "string" ? input : input.url);
  }
}
