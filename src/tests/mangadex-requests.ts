/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { expect } from "chai";

import { getDiscoverSectionItems } from "../MangaDex/discover.js";
import { getSearchResults } from "../MangaDex/search.js";
import { saveBlockedGroups, setGroupBlockingEnabled } from "../MangaDex/state/blocking.js";
import { DISCOVER_SECTIONS } from "../MangaDex/state/discover.js";
import { resetAllSettings } from "../MangaDex/state/reset.js";
import { withFakeNetwork } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const GROUP = "44444444-4444-4444-8444-444444444444";
const EMPTY_LIST = { body: { data: [], total: 0, limit: 0, offset: 0 } };

/** What MangaDex asks the API for, checked from the requests a flow actually makes. */
export function registerMangaDexRequestTests(suite: TestSuite): void {
  suite.test(
    "discover: Latest Updates leaves out blocked groups only while blocking is on",
    async () => {
      const latest = { id: DISCOVER_SECTIONS.LATEST_UPDATES, title: "Latest", type: 0 } as never;
      const requestedUrl = async () =>
        withFakeNetwork([["/chapter?", EMPTY_LIST]], async (network) => {
          await getDiscoverSectionItems(latest, undefined);
          return decodeURIComponent(network.requests[0]?.url ?? "");
        });

      resetAllSettings();
      try {
        saveBlockedGroups({ [GROUP]: { id: GROUP } as never });
        expect(await requestedUrl(), "blocking off").to.not.contain("excludedGroups");

        setGroupBlockingEnabled(true);
        expect(await requestedUrl()).to.contain(`excludedGroups[]=${GROUP}`);
      } finally {
        resetAllSettings();
      }
    },
  );

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
