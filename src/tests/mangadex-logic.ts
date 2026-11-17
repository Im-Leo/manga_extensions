/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { ContentRating } from "@paperback/types";
import { expect } from "chai";

import { isGroupNameBlocked } from "../MangaDex/chapter-helpers.js";
import { RATINGS } from "../MangaDex/lookups.js";
import { MDContentRating, Status } from "../MangaDex/models.js";
import {
  aggregateContainsLastChapter,
  parseChapterTitle,
  reconcileStoredCompletedStatus,
} from "../MangaDex/parsers.js";
import { paperbackToMangaDexRatings, resolvePaperbackRating } from "../MangaDex/ratings.js";
import { applyTagFilters } from "../MangaDex/search/filters.js";
import { isAuthInvalidError, readJwtBody } from "../MangaDex/state/auth.js";
import { SETTING_KEYS } from "../MangaDex/state/keys.js";
import { resetAllSettings } from "../MangaDex/state/reset.js";
import { CONTENT_RATING_GROUP, SYNTHETIC_RATING_ID_TO_NAME } from "../MangaDex/tags.js";
import { parseJSONBody, precomputeQuery, relevanceScore } from "../MangaDex/utils.js";
import type { TestSuite } from "./suite.js";

/** The synthetic tag id the search form uses for `rating`. */
function ratingTagId(rating: MDContentRating): string {
  return Object.entries(SYNTHETIC_RATING_ID_TO_NAME).find(([, name]) => name === rating)![0];
}

/** The base64url form a JWT carries: no padding, and "-" and "_" for "+" and "/". */
function base64Url(json: string): string {
  return (Application.base64Encode(json) as string)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Pure MangaDex logic: scoring, parsing, and the rating and filter vocabularies. */
export function registerMangaDexLogicTests(suite: TestSuite): void {
  suite.test("relevanceScore: ranks exact, prefix and whole-word matches in order", async () => {
    const query = precomputeQuery("Solo Leveling");

    expect(relevanceScore("Solo Leveling", query)).to.equal(100);
    expect(relevanceScore("Solo Leveling: Ragnarok", query)).to.equal(99);
    expect(relevanceScore("The Return of Solo Leveling", query)).to.equal(95);
    expect(relevanceScore("Omniscient Reader", query), "below the blocking threshold").to.be.below(
      70,
    );
    expect(relevanceScore("Anything", precomputeQuery("   ")), "an empty query").to.equal(0);
  });

  suite.test("isGroupNameBlocked: matches loosely and remembers the answer", async () => {
    const blocked = [precomputeQuery("Lily Scans")];
    const cache = new Map<string, boolean>();

    expect(isGroupNameBlocked("Lily Scans", blocked, cache)).to.equal(true);
    expect(isGroupNameBlocked("Official Publisher", blocked, cache)).to.equal(false);
    expect(cache.get("Lily Scans"), "cached").to.equal(true);
  });

  suite.test("parseJSONBody: parses JSON and explains everything else", async () => {
    expect(parseJSONBody<{ ok: boolean }>('  \n{"ok":true}', 200)).to.deep.equal({ ok: true });
    expect(parseJSONBody<number[]>([1, 2], 200), "already parsed").to.deep.equal([1, 2]);

    expect(() => parseJSONBody("<html>", 503)).to.throw("503 MangaDex Unavailable");
    expect(() => parseJSONBody("<html>", 404)).to.throw("404 MangaDex Request Failed");
    expect(() => parseJSONBody(" <p>hi</p>", 200), "quotes what came back").to.throw("<p>hi</p>");
  });

  suite.test("readJwtBody: decodes a base64url body, rejects malformed tokens", async () => {
    // "~?" encodes to characters that differ between base64 and base64url.
    const body = base64Url('{"exp":1,"sub":"~?>"}');

    expect(readJwtBody(`header.${body}.signature`)).to.deep.equal({ exp: 1, sub: "~?>" });
    expect(readJwtBody("no-dots")).to.equal(null);
    expect(readJwtBody(`header.${base64Url("not json")}.signature`)).to.equal(null);
  });

  suite.test("isAuthInvalidError: signs out only on a rejected credential", async () => {
    expect(isAuthInvalidError(new Error("Request failed with status code: 401"))).to.equal(true);
    expect(isAuthInvalidError(new Error("invalid_grant"))).to.equal(true);
    expect(isAuthInvalidError(new Error("Request failed with status code: 503"))).to.equal(false);
    expect(isAuthInvalidError("network unreachable")).to.equal(false);
  });

  suite.test("ratings: every MangaDex rating maps both ways, unknown reads as adult", async () => {
    expect(resolvePaperbackRating(MDContentRating.Safe)).to.equal(ContentRating.EVERYONE);
    expect(resolvePaperbackRating("a-rating-added-later"), "the safe direction").to.equal(
      ContentRating.ADULT,
    );
    for (const rating of RATINGS) {
      expect(paperbackToMangaDexRatings[rating.paperback], rating.enum).to.include(rating.enum);
    }
  });

  suite.test("applyTagFilters: rating tags adjust ratings, other tags filter", async () => {
    const filters = applyTagFilters(
      {
        [CONTENT_RATING_GROUP]: {
          [ratingTagId(MDContentRating.Erotica)]: "included",
          [ratingTagId(MDContentRating.Safe)]: "excluded",
        },
        genre: { action: "included", horror: "excluded" },
      },
      [MDContentRating.Safe, MDContentRating.Suggestive],
    );

    expect([...filters.ratings].sort()).to.deep.equal(
      [MDContentRating.Erotica, MDContentRating.Suggestive].sort(),
    );
    expect(filters.includedTags).to.deep.equal(["action"]);
    expect(filters.excludedTags).to.deep.equal(["horror"]);
  });

  suite.test("completed status: trusted only once the final chapter is uploaded", async () => {
    const aggregate = {
      result: "ok",
      volumes: { "1": { volume: "1", count: 1, chapters: { "10": {} } } },
    } as never;

    expect(aggregateContainsLastChapter(aggregate, "10", "1")).to.equal(true);
    expect(aggregateContainsLastChapter(aggregate, "11", "1")).to.equal(false);
    expect(aggregateContainsLastChapter(aggregate, undefined)).to.equal(false);

    expect(reconcileStoredCompletedStatus(Status.Completed, Status.PublishingFinished)).to.equal(
      Status.PublishingFinished,
    );
    expect(reconcileStoredCompletedStatus(Status.Ongoing, Status.PublishingFinished)).to.equal(
      Status.Ongoing,
    );
  });

  suite.test("parseChapterTitle: prefixes follow the settings passed", async () => {
    const attributes = { volume: "2", chapter: "14", title: "Return &amp; Rise" };
    const all = { showVolume: true, showChapter: true };

    expect(parseChapterTitle(attributes, { ...all, compact: false })).to.equal(
      "Vol. 2 Ch. 14 - Return & Rise",
    );
    expect(parseChapterTitle(attributes, { ...all, compact: true })).to.equal(
      "V. 2 C. 14 - Return & Rise",
    );
    expect(
      parseChapterTitle({ chapter: "3" }, { showVolume: false, showChapter: true, compact: false }),
    ).to.equal("Ch. 3");
    expect(parseChapterTitle({ title: "Oneshot" }, { ...all, compact: false })).to.equal("Oneshot");
  });

  suite.test("resetAllSettings: every setting returns to its default", async () => {
    for (const key of Object.values(SETTING_KEYS)) Application.setState("changed", key);

    resetAllSettings();

    for (const key of Object.values(SETTING_KEYS)) {
      expect(Application.getState(key), key).to.equal(undefined);
    }
  });
}
