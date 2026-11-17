/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import {
  CloudflareError,
  ContentRating,
  type Cookie,
  type CookieStorageInterceptor,
} from "@paperback/types";
import { expect } from "chai";

import {
  ContentRatingCache,
  RatingResolver,
  UNRATED_LISTING_DEFAULT,
  rateContent,
} from "../utils/content-rating.js";
import { SiteInterceptor, persistCloudflareCookies } from "../utils/interceptor.js";
import { HttpError } from "../utils/network.js";
import { normalizeRating } from "../utils/rating.js";
import { htmlToPlainText } from "../utils/text.js";
import { rejectionOf } from "./async.js";
import type { TestSuite } from "./suite.js";

const RATINGS_KEY = "ratings_test";
const SITE = "https://example.com";
const CDN = "https://cdn.example.com";

function fakeCookieStorage() {
  const stored: string[] = [];
  const storage = { setCookie: (entry: Cookie) => stored.push(entry.name) };

  return { stored, storage: storage as unknown as CookieStorageInterceptor };
}

function cookie(name: string): Cookie {
  return { name, value: "v", domain: "example.com" };
}

function response(status: number, headers: Record<string, string> = {}) {
  return { status, headers } as unknown as Parameters<SiteInterceptor["interceptResponse"]>[1];
}

const EMPTY_BODY = new ArrayBuffer(0);

/**
 * Tests for `src/utils/`, the code four sources share.
 *
 * A regression here reaches all of them, and no per-source suite exercises it
 * directly. Registered from one suite because the runner discovers only
 * `src/tests/<SourceId>.ts`, and pure functions prove nothing more run five
 * times.
 */
export function registerSharedUtilTests(suite: TestSuite): void {
  suite.test("ContentRatingCache: persists across sessions when given a key", async () => {
    // Resolving a listing costs one request per tile, so a cache that dies with
    // the session makes every app launch pay for it again.
    const store: Record<string, unknown> = {};
    const fake = {
      read: (key: string) => store[key],
      write: (key: string, value: unknown) => {
        store[key] = value;
      },
    };

    const first = new ContentRatingCache(RATINGS_KEY, fake);
    first.remember("alpha", ContentRating.ADULT);
    expect(store[RATINGS_KEY], "nothing is written until the batch settles").to.equal(undefined);

    first.flush();
    expect(store[RATINGS_KEY], "flush writes the batch once").to.not.equal(undefined);

    // A fresh instance is what a relaunch looks like.
    const reloaded = new ContentRatingCache(RATINGS_KEY, fake);
    expect(reloaded.knows("alpha"), "survives a restart").to.equal(true);
    expect(reloaded.recall("alpha")).to.equal(ContentRating.ADULT);

    // Without a key the cache stays in memory and touches no storage.
    const ephemeral = new ContentRatingCache(undefined, fake);
    ephemeral.remember("beta", ContentRating.ADULT);
    ephemeral.flush();
    expect(Object.keys(store).length, "an unkeyed cache writes nothing").to.equal(1);
  });

  suite.test("rateContent: a genre matches by slug as well as by display name", async () => {
    // A detail page gives "Sexual Violence"; browsing gives "sexual-violence".
    // Both reach this classifier, so both have to resolve to the same rating.
    expect(rateContent(["Sexual Violence"])).to.equal(ContentRating.MATURE);
    expect(rateContent(["sexual-violence"]), "the slug form").to.equal(ContentRating.MATURE);
    expect(rateContent(["SM-BDSM"]), "slug, uppercased").to.equal(ContentRating.ADULT);
    expect(rateContent(["r-18"]), "an explicit rating marker").to.equal(ContentRating.ADULT);
  });

  suite.test("rateContent: covers the explicit genres these sites actually use", async () => {
    // Drawn from MangaKakalot's own genre list; each of these was rating as
    // EVERYONE, so a title carrying only one of them never blurred.
    for (const genre of [
      "r-18",
      "netorare",
      "netori",
      "incest",
      "sm-bdsm",
      "fetish",
      "loli",
      "shota",
    ]) {
      expect(rateContent([genre]), `${genre} must be adult`).to.equal(ContentRating.ADULT);
    }

    // Suggestive rather than explicit.
    for (const genre of ["ecchi", "gore", "sexual-violence"]) {
      expect(rateContent([genre]), `${genre} is mature`).to.equal(ContentRating.MATURE);
    }

    // Broad descriptive tags must not be treated as mature: most action titles
    // carry one, and masking those hides a library rather than a few covers.
    for (const genre of ["violence", "bloody", "suggestive", "romance", "school-life", "action"]) {
      expect(rateContent([genre]), `${genre} is safe`).to.equal(ContentRating.EVERYONE);
    }
  });

  suite.test("htmlToPlainText: keeps paragraphs, drops tags, decodes every entity", async () => {
    const html =
      "<p>First &amp; <strong>bold</strong>.</p><p>Second&#8217;s line<br>broken&nbsp;here</p>";
    expect(htmlToPlainText(html)).to.equal("First & bold.\n\nSecond’s line\nbroken here");
    expect(htmlToPlainText("  plain text  ")).to.equal("plain text");
  });

  suite.test("normalizeRating: scales to 0-1 and treats no score as none", async () => {
    expect(normalizeRating(4, 5)).to.equal(0.8);
    expect(normalizeRating(9.5, 10)).to.equal(0.95);
    expect(normalizeRating(12, 10), "clamped").to.equal(1);
    for (const score of [0, -1, Number.NaN]) {
      expect(normalizeRating(score, 10), String(score)).to.equal(undefined);
    }
    expect(normalizeRating(4, 0), "no scale").to.equal(undefined);
  });

  suite.test("rateContent: no genres at all is unknown, not safe", async () => {
    expect(rateContent(undefined)).to.equal(UNRATED_LISTING_DEFAULT);
    expect(rateContent([])).to.equal(UNRATED_LISTING_DEFAULT);
    expect(rateContent(["a genre nobody classifies"]), "known to be unclassified").to.equal(
      ContentRating.EVERYONE,
    );
  });

  suite.test("RatingResolver: never exceeds its concurrency cap", async () => {
    const cache = new ContentRatingCache();
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);

    // Yields are microtasks, not timers: the runner's vm context has no
    // `setTimeout`, and the resolver's catch would swallow the ReferenceError,
    // leaving the pool looking unbounded.
    let inFlight = 0;
    let peak = 0;
    const resolver = new RatingResolver(
      cache,
      async (mangaId) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        cache.remember(mangaId, ContentRating.EVERYONE);
        inFlight--;
      },
      4,
    );
    // Two listings at once, as on launch: they share the one cap.
    await Promise.all([resolver.resolve(ids.slice(0, 12)), resolver.resolve(ids.slice(8))]);

    expect(peak, "at most 4 requests outstanding").to.be.at.most(4);
    expect(cache.knows("id-19"), "every title still resolved").to.equal(true);
  });

  suite.test("RatingResolver: overlapping calls fetch a title once", async () => {
    const cache = new ContentRatingCache();
    const fetched: string[] = [];
    const resolver = new RatingResolver(cache, async (mangaId) => {
      fetched.push(mangaId);
      await Promise.resolve();
      cache.remember(mangaId, ContentRating.MATURE);
    });

    await Promise.all([resolver.resolve(["a", "shared"]), resolver.resolve(["shared", "b"])]);

    expect([...fetched].sort()).to.deep.equal(["a", "b", "shared"]);
  });

  suite.test("RatingResolver: fetches only what the cache lacks", async () => {
    const cache = new ContentRatingCache();
    cache.remember("known", ContentRating.EVERYONE);

    const fetched: string[] = [];
    await new RatingResolver(cache, async (mangaId) => {
      fetched.push(mangaId);
      cache.remember(mangaId, ContentRating.ADULT);
    }).resolve(["known", "unknown-a", "unknown-b"]);

    expect(fetched.sort(), "an already-known title is not refetched").to.deep.equal([
      "unknown-a",
      "unknown-b",
    ]);
    expect(cache.recall("unknown-a")).to.equal(ContentRating.ADULT);
  });

  suite.test("RatingResolver: de-duplicates and skips empty ids", async () => {
    const cache = new ContentRatingCache();
    let calls = 0;

    await new RatingResolver(cache, async (mangaId) => {
      calls++;
      cache.remember(mangaId, ContentRating.MATURE);
    }).resolve(["dup", "dup", "dup", ""]);

    expect(calls, "one request per distinct title").to.equal(1);
  });

  suite.test("RatingResolver: one failure does not sink the batch", async () => {
    const cache = new ContentRatingCache();

    await new RatingResolver(cache, async (mangaId) => {
      if (mangaId === "bad") throw new Error("404");
      cache.remember(mangaId, ContentRating.ADULT);
    }).resolve(["good", "bad"]);

    expect(cache.recall("good"), "the readable title resolved").to.equal(ContentRating.ADULT);
    expect(cache.recall("bad"), "the failed one keeps the default").to.equal(
      UNRATED_LISTING_DEFAULT,
    );
  });

  suite.test("rateContent: adult wins, mature is a floor, casing is irrelevant", async () => {
    expect(rateContent(["Action", "Comedy"]), "nothing recognized").to.equal(
      ContentRating.EVERYONE,
    );
    expect(rateContent(["Ecchi"]), "mature genre").to.equal(ContentRating.MATURE);
    expect(rateContent(["Adult"]), "adult genre").to.equal(ContentRating.ADULT);

    expect(rateContent(["  aDuLt "]), "trimmed and lowercased").to.equal(ContentRating.ADULT);

    expect(rateContent(["Ecchi", "Smut"]), "adult found after mature").to.equal(
      ContentRating.ADULT,
    );
  });

  suite.test("rateContent: an unknown genre never hides a title", async () => {
    expect(rateContent(["Isekai", "Cooking", "Time Travel"])).to.equal(ContentRating.EVERYONE);
  });

  suite.test("ContentRatingCache: unknown titles fall back, learned ones do not", async () => {
    const cache = new ContentRatingCache();

    expect(UNRATED_LISTING_DEFAULT, "unknown must not read as safe").to.not.equal(
      ContentRating.EVERYONE,
    );
    expect(cache.recall("unseen"), "unknown title").to.equal(UNRATED_LISTING_DEFAULT);

    cache.remember("seen", ContentRating.EVERYONE);
    expect(cache.recall("seen"), "a learned rating overrides the default").to.equal(
      ContentRating.EVERYONE,
    );

    cache.remember("seen", ContentRating.ADULT);
    expect(cache.recall("seen"), "later reads win").to.equal(ContentRating.ADULT);

    cache.remember("", ContentRating.ADULT);
    expect(cache.recall("", ContentRating.MATURE), "an empty id is not cached").to.equal(
      ContentRating.MATURE,
    );
  });

  suite.test("persistCloudflareCookies: stores every Cloudflare cookie, not just one", async () => {
    const { stored, storage } = fakeCookieStorage();

    persistCloudflareCookies(
      [
        cookie("cf_clearance"),
        cookie("__cf_bm"),
        cookie("_cfuvid"),
        cookie("cf_chl_2"),
        cookie("session_id"),
        cookie("theme"),
      ],
      storage,
    );

    expect(stored).to.deep.equal(["cf_clearance", "__cf_bm", "_cfuvid", "cf_chl_2"]);
  });

  suite.test("interceptRequest: sets Referer, user agent, and configured cookies", async () => {
    const interceptor = new SiteInterceptor("test", {
      domain: SITE,
      cookies: { isAdult: "1" },
    });

    const result = await interceptor.interceptRequest({
      url: `${CDN}/cover.jpg`,
      method: "GET",
      cookies: { existing: "kept" },
    });

    expect(result.headers?.["referer"]).to.equal(`${SITE}/`);
    expect(result.headers?.["user-agent"], "a real user agent").to.be.a("string").and.not.equal("");
    expect(result.cookies, "configured cookies merge with existing ones").to.deep.equal({
      existing: "kept",
      isAdult: "1",
    });
  });

  suite.test("interceptRequest: a request's own Referer and user agent win", async () => {
    const interceptor = new SiteInterceptor("test", { domain: SITE });

    const result = await interceptor.interceptRequest({
      url: `${SITE}/chapterfun.ashx`,
      method: "GET",
      headers: { Referer: `${SITE}/manga/x/c001/1.html`, "User-Agent": "custom" },
    });

    expect(result.headers, "no second, lowercase copy is added").to.deep.equal({
      Referer: `${SITE}/manga/x/c001/1.html`,
      "User-Agent": "custom",
    });
  });

  suite.test(
    "interceptResponse: a Cloudflare challenge is resolved on the challenged URL",
    async () => {
      const interceptor = new SiteInterceptor("test", { domain: SITE });

      const raised = await rejectionOf(
        interceptor.interceptResponse(
          { url: `${SITE}/search/story/solo`, method: "GET" },
          // Mixed case: header names are case-insensitive and servers vary.
          response(403, { "CF-Mitigated": "challenge" }),
          EMPTY_BODY,
        ),
      );

      expect(raised, "a challenge must not be returned as data").to.be.instanceOf(CloudflareError);
      expect((raised as CloudflareError).resolutionRequest.url).to.equal(
        `${SITE}/search/story/solo`,
      );
    },
  );

  suite.test("interceptResponse: requireOk decides whether a non-200 throws", async () => {
    const lenient = new SiteInterceptor("test", { domain: SITE });
    const strict = new SiteInterceptor("test", { domain: SITE, requireOk: true });
    const request = { url: `${SITE}/x`, method: "GET" };

    const passed = await lenient.interceptResponse(request, response(404), EMPTY_BODY);
    expect(passed, "lenient passes the body through").to.equal(EMPTY_BODY);

    const failure = await rejectionOf(strict.interceptResponse(request, response(404), EMPTY_BODY));
    expect(failure, "callers can tell a missing page from other failures").to.be.instanceOf(
      HttpError,
    );
    expect((failure as HttpError).status).to.equal(404);

    const ok = await strict.interceptResponse(request, response(200), EMPTY_BODY);
    expect(ok, "a 200 passes even under requireOk").to.equal(EMPTY_BODY);
  });

  suite.test("interceptResponse: requireOk guards pages, never images", async () => {
    const strict = new SiteInterceptor("test", { domain: SITE, requireOk: true });
    const page = { url: `${SITE}/manga/x`, method: "GET" };
    const image = { url: `${CDN}/cover.webp`, method: "GET" };

    // Cover CDNs set `max-age`, so an image the app already holds comes back as
    // 304; and one that genuinely fails should leave a blank cover rather than
    // throw an error through a grid of them.
    expect(await strict.interceptResponse(image, response(304), EMPTY_BODY)).to.equal(EMPTY_BODY);
    expect(await strict.interceptResponse(image, response(403), EMPTY_BODY)).to.equal(EMPTY_BODY);

    // Pages still have to fail loudly: this site answers a bad path with an
    // error page that parses, which would otherwise surface as empty content.
    expect(await strict.interceptResponse(page, response(304), EMPTY_BODY)).to.equal(EMPTY_BODY);

    await rejectionOf(strict.interceptResponse(page, response(404), EMPTY_BODY));
  });
}
