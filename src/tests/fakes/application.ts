/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { Request, Response } from "@paperback/types";

/**
 * Network double for code that calls `Application.scheduleRequest` directly.
 *
 * The test runner's `Application` polyfill keeps real in-memory state but sends
 * requests to the live site. Swapping only `scheduleRequest` keeps everything
 * else genuine, and lets a test assert what was requested and how often — which
 * is how request coalescing and auth flows are verified.
 *
 * Interceptors are bypassed: they are tested directly, and here they would only
 * obscure what the code under test sent.
 */

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  /** A string is sent as-is; anything else is JSON-encoded. */
  body?: unknown;
}

export type FakeRoute = FakeResponse | ((request: Request) => FakeResponse | Promise<FakeResponse>);

/** First match wins. A string matches as a URL substring. */
export type RouteTable = readonly (readonly [string | RegExp, FakeRoute])[];

export interface FakeNetwork {
  readonly requests: readonly Request[];
  /** Requests whose URL matches `pattern`. */
  count(pattern: string | RegExp): number;
}

function matches(pattern: string | RegExp, url: string): boolean {
  return typeof pattern === "string" ? url.includes(pattern) : pattern.test(url);
}

function encode(body: unknown): ArrayBuffer {
  const text = typeof body === "string" ? body : body === undefined ? "" : JSON.stringify(body);
  return new TextEncoder().encode(text).buffer;
}

/**
 * Runs `body` with requests answered from `routes`, restoring the real
 * implementation afterwards even when `body` throws.
 *
 * An unmatched request throws rather than falling through to the network, so a
 * missing route fails the test instead of silently hitting the real site.
 */
export async function withFakeNetwork<T>(
  routes: RouteTable,
  body: (network: FakeNetwork) => Promise<T>,
): Promise<T> {
  const original = Application.scheduleRequest;
  const requests: Request[] = [];

  const scheduleRequest = async (request: Request): Promise<[Response, ArrayBuffer]> => {
    requests.push(request);

    const route = routes.find(([pattern]) => matches(pattern, request.url))?.[1];
    if (route === undefined) throw new Error(`Unrouted request in test: ${request.url}`);

    const answer = typeof route === "function" ? await route(request) : route;
    const response: Response = {
      url: request.url,
      status: answer.status ?? 200,
      headers: answer.headers ?? {},
      cookies: [],
    };

    return [response, encode(answer.body)];
  };

  Object.assign(Application, { scheduleRequest });
  try {
    return await body({
      requests,
      count: (pattern) => requests.filter((request) => matches(pattern, request.url)).length,
    });
  } finally {
    Object.assign(Application, { scheduleRequest: original });
  }
}

/** The request body as the server would read it. */
export function requestBodyText(request: Request): string {
  const { body } = request;
  if (body === undefined) return "";
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  return JSON.stringify(body);
}
