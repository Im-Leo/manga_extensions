/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { ContentRating } from "@paperback/types";
import { expect } from "chai";

import { TtlCache, singleFlight } from "../utils/cache.js";
import { ContentRatingCache } from "../utils/content-rating.js";
import {
  HttpError,
  InvalidResponseError,
  fetchJSON,
  fetchResponse,
  fetchText,
  headerValue,
} from "../utils/network.js";
import { URLBuilder } from "../utils/url-builder/base.js";
import { rejectionOf } from "./async.js";
import { withFakeNetwork } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

/** A promise the test settles by hand, to hold a load in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Tests for the request layer every source sits on: URL building, the
 * fail-loudly readers, and request coalescing.
 */
export function registerSharedNetworkTests(suite: TestSuite): void {
  suite.test("URLBuilder: joins paths and drops empty values", async () => {
    const url = new URLBuilder("https://api.example.com/")
      .addPath("/v1/")
      .addPath("series")
      .addQuery("page", 2)
      .addQuery("search", "")
      .build();

    expect(url).to.equal("https://api.example.com/v1/series?page=2");
    expect(new URLBuilder("https://x.com").build(), "no path, no query").to.equal("https://x.com");
  });

  suite.test("URLBuilder: array style is per endpoint, objects skip undefined fields", async () => {
    const bracket = new URLBuilder("https://x.com").addQuery("ids", ["a", "b"]).build();
    const repeat = new URLBuilder("https://x.com", "repeat").addQuery("genres", ["a", "b"]).build();
    const object = new URLBuilder("https://x.com")
      .addQuery("order", { title: "asc", year: undefined })
      .build();

    expect(bracket).to.equal("https://x.com?ids[]=a&ids[]=b");
    expect(repeat).to.equal("https://x.com?genres=a&genres=b");
    expect(object).to.equal("https://x.com?order[title]=asc");
  });

  suite.test("URLBuilder: reset clears paths and query", async () => {
    const builder = new URLBuilder("https://x.com").addPath("a").addQuery("q", 1);
    expect(builder.reset().addPath("b").build()).to.equal("https://x.com/b");
  });

  suite.test("fetchText: success and 304 return the body, failures raise HttpError", async () => {
    await withFakeNetwork(
      [
        ["/ok", { body: "fine" }],
        ["/cached", { status: 304, body: "cached" }],
        ["/broken", { status: 503, body: "<html>maintenance</html>" }],
      ],
      async () => {
        expect(await fetchText("https://x.com/ok")).to.equal("fine");
        expect(await fetchText("https://x.com/cached")).to.equal("cached");

        const error = await rejectionOf(fetchText("https://x.com/broken?token=secret"));
        expect(error).to.be.instanceOf(HttpError);
        expect((error as HttpError).status).to.equal(503);
        expect(error.message, "names the endpoint").to.contain("https://x.com/broken");
        expect(error.message, "but not its query").to.not.contain("secret");
      },
    );
  });

  suite.test("fetchJSON: a page that is not JSON fails instead of reading as empty", async () => {
    await withFakeNetwork(
      [
        ["/json", { body: { items: [1, 2] } }],
        ["/challenge", { body: "<!DOCTYPE html><title>Just a moment...</title>" }],
      ],
      async () => {
        expect(await fetchJSON<{ items: number[] }>("https://x.com/json")).to.deep.equal({
          items: [1, 2],
        });

        const error = await rejectionOf(fetchJSON("https://x.com/challenge"));
        expect(error).to.be.instanceOf(InvalidResponseError);
      },
    );
  });

  suite.test("fetchResponse: leaves the status for the caller to judge", async () => {
    await withFakeNetwork([["/gone", { status: 404, body: '{"notFound":true}' }]], async () => {
      const { response, body } = await fetchResponse("https://x.com/gone");
      expect(response.status).to.equal(404);
      expect(body).to.equal('{"notFound":true}');
    });
  });

  suite.test("headerValue: matches header names case-insensitively", async () => {
    const headers = { "Content-Type": "image/webp" };

    expect(headerValue(headers, "content-type")).to.equal("image/webp");
    expect(headerValue(headers, "CONTENT-TYPE")).to.equal("image/webp");
    expect(headerValue(headers, "etag")).to.equal(undefined);
    expect(headerValue(undefined, "etag")).to.equal(undefined);
  });

  suite.test("singleFlight: concurrent callers share one load", async () => {
    let loads = 0;
    const gate = deferred<string>();
    const load = singleFlight(() => {
      loads++;
      return gate.promise;
    });

    const first = load();
    const second = load();
    gate.resolve("value");

    expect(await Promise.all([first, second])).to.deep.equal(["value", "value"]);
    expect(loads, "one load for both callers").to.equal(1);

    await load();
    expect(loads, "a settled load is not reused").to.equal(2);
  });

  suite.test("singleFlight: a failure reaches waiting callers but is not replayed", async () => {
    let attempt = 0;
    const load = singleFlight(async () => {
      attempt++;
      if (attempt === 1) throw new Error("blip");
      return "recovered";
    });

    const failures = await Promise.all([rejectionOf(load()), rejectionOf(load())]);
    expect(failures.map((error) => error.message)).to.deep.equal(["blip", "blip"]);
    expect(await load(), "the next call retries").to.equal("recovered");
  });

  suite.test("TtlCache: serves within the TTL, reloads after it", async () => {
    let time = 0;
    let loads = 0;
    const cache = new TtlCache<string, number>(1000, 50, () => time);
    const load = async () => ++loads;

    expect(await cache.get("k", load)).to.equal(1);
    time = 999;
    expect(await cache.get("k", load), "still fresh").to.equal(1);
    time = 1000;
    expect(await cache.get("k", load), "expired").to.equal(2);
  });

  suite.test("TtlCache: a caller arriving mid-load joins it", async () => {
    let loads = 0;
    const gate = deferred<string>();
    const cache = new TtlCache<string, string>(1000);
    const load = () => {
      loads++;
      return gate.promise;
    };

    const first = cache.get("k", load);
    const second = cache.get("k", load);
    gate.resolve("shared");

    expect(await Promise.all([first, second])).to.deep.equal(["shared", "shared"]);
    expect(loads).to.equal(1);
  });

  suite.test("TtlCache: a rejected load is evicted, not cached", async () => {
    let attempt = 0;
    const cache = new TtlCache<string, string>(60_000);
    const load = async () => {
      attempt++;
      if (attempt === 1) throw new Error("blip");
      return "ok";
    };

    await rejectionOf(cache.get("k", load));
    expect(await cache.get("k", load), "retried at once").to.equal("ok");
  });

  suite.test("TtlCache: over capacity, the least recently loaded key goes first", async () => {
    const cache = new TtlCache<string, string>(60_000, 2);
    let loads = 0;
    const load = async (key: string) => {
      loads++;
      return key;
    };

    await cache.get("a", load);
    await cache.get("b", load);
    await cache.get("c", load);
    expect(loads).to.equal(3);

    await cache.get("c", load);
    await cache.get("b", load);
    expect(loads, "b and c survived").to.equal(3);

    await cache.get("a", load);
    expect(loads, "a was evicted").to.equal(4);
  });

  suite.test("ContentRatingCache: the persisted cap drops the least recently learned", async () => {
    const store: Record<string, unknown> = {};
    const cache = new ContentRatingCache("ratings_cap", {
      read: (key) => store[key],
      write: (key, value) => {
        store[key] = value;
      },
    });

    cache.remember("first", ContentRating.ADULT);
    cache.remember("second", ContentRating.ADULT);
    for (let i = 0; i < 1999; i++) cache.remember(`filler-${i}`, ContentRating.EVERYONE);
    // Re-learning "first" makes it recent again, so "second" is now the oldest.
    cache.remember("first", ContentRating.MATURE);
    cache.flush();

    const persisted = store["ratings_cap"] as Record<string, string>;
    expect(Object.keys(persisted)).to.have.lengthOf(2000);
    expect(persisted["first"], "re-learned title survives").to.equal(ContentRating.MATURE);
    expect(persisted["second"], "oldest title dropped").to.equal(undefined);
  });
}
