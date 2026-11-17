/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { expect } from "chai";

import { getSearchResults } from "../MangaDex/search.js";
import { withFakeNetwork } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const EMPTY_LIST = { body: { data: [], total: 0, limit: 0, offset: 0 } };

/** What MangaDex asks the API for, checked from the requests a flow actually makes. */
export function registerMangaDexRequestTests(suite: TestSuite): void {
  suite.test("search: an exact id lookup ignores the language filter", async () => {
    await withFakeNetwork([["/manga?", EMPTY_LIST]], async (network) => {
      await getSearchResults({ title: ALPHA }, undefined, undefined);

      const url = decodeURIComponent(network.requests[0]?.url ?? "");
      expect(url).to.contain(`ids[]=${ALPHA}`);
      expect(url, "a pasted title is found whatever its languages").to.not.contain(
        "availableTranslatedLanguage",
      );
    });
  });

  suite.test("search: a title search keeps the language filter", async () => {
    await withFakeNetwork([["/manga?", EMPTY_LIST]], async (network) => {
      await getSearchResults({ title: "frieren" }, undefined, undefined);

      expect(decodeURIComponent(network.requests[0]?.url ?? "")).to.contain(
        "availableTranslatedLanguage",
      );
    });
  });
}
