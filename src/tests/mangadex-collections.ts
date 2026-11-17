/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { ManagedCollection, ManagedCollectionChange, SourceManga } from "@paperback/types";
import { expect } from "chai";

import {
  applyManagedCollectionChanges,
  getManagedCollectionItems,
  getManagedCollections,
} from "../MangaDex/collection.js";
import { saveAccessToken } from "../MangaDex/state/auth.js";
import { rejectionOf } from "./async.js";
import { requestBodyText, withFakeNetwork } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

const ALPHA = "11111111-1111-4111-8111-111111111111";
const BETA = "22222222-2222-4222-8222-222222222222";
const GAMMA = "33333333-3333-4333-8333-333333333333";

const STATUS_LIST = "/manga/status";
const MANGA_LIST = "/manga?";

/** A token the session treats as valid for the next hour. */
function signIn(): void {
  // Typed as string | ArrayBuffer; the runtime returns base64 text for a string.
  const body = Application.base64Encode(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ) as string;
  saveAccessToken(`header.${body.replace(/=+$/, "")}.signature`, "refresh");
}

function signOut(): void {
  saveAccessToken(undefined, undefined);
}

function entity(id: string, title: string) {
  return {
    id,
    type: "manga",
    attributes: {
      title: { en: title },
      altTitles: [],
      description: { en: "" },
      status: "ongoing",
      contentRating: "safe",
      tags: [],
      originalLanguage: "ja",
      availableTranslatedLanguages: ["en"],
      latestUploadedChapter: null,
    },
    relationships: [],
  };
}

function collection(id: string): ManagedCollection {
  return { id, title: id, exclusiveGroup: "reading-status" };
}

function change(
  id: string,
  type: "add" | "remove" | "move",
  mangaId: string,
  from?: string,
  to?: string,
): ManagedCollectionChange {
  const sourceManga = { mangaId } as SourceManga;
  return {
    id,
    type,
    sourceManga,
    from: from && collection(from),
    to: to && collection(to),
  } as ManagedCollectionChange;
}

/** MangaDex reading statuses as Paperback managed collections. */
export function registerMangaDexCollectionTests(suite: TestSuite): void {
  suite.test("collections: one exclusive group, since a title has one reading status", async () => {
    const collections = await getManagedCollections();

    expect(collections.map((c) => c.id)).to.include.members([
      "reading",
      "completed",
      "plan_to_read",
    ]);
    expect(new Set(collections.map((c) => c.exclusiveGroup)).size).to.equal(1);
  });

  suite.test("collections: items for several collections cost one status request", async () => {
    signIn();

    await withFakeNetwork(
      [
        [
          STATUS_LIST,
          {
            body: {
              result: "ok",
              statuses: { [ALPHA]: "reading", [BETA]: "completed", [GAMMA]: "dropped" },
            },
          },
        ],
        [
          MANGA_LIST,
          { body: { result: "ok", data: [entity(ALPHA, "Alpha"), entity(BETA, "Beta")] } },
        ],
      ],
      async (network) => {
        const items = await getManagedCollectionItems([
          collection("reading"),
          collection("completed"),
        ]);

        expect(
          items.map((entry) => [entry.collectionId, entry.items.map((m) => m.mangaId)]),
        ).to.deep.equal([
          ["reading", [ALPHA]],
          ["completed", [BETA]],
        ]);
        expect(network.count(STATUS_LIST), "statuses fetched once").to.equal(1);
        expect(network.count(MANGA_LIST), "details fetched once").to.equal(1);
        expect(network.requests[1]?.url, "only titles in the requested collections").to.not.contain(
          GAMMA,
        );
      },
    );

    signOut();
  });

  suite.test("collections: add and move set the target status, remove clears it", async () => {
    signIn();

    await withFakeNetwork(
      [[/\/manga\/[0-9a-f-]+\/status/, { body: { result: "ok" } }]],
      async (network) => {
        const failures = await applyManagedCollectionChanges([
          change("1", "add", ALPHA, undefined, "reading"),
          change("2", "move", BETA, "reading", "completed"),
          change("3", "remove", GAMMA, "dropped"),
        ]);

        expect(failures).to.deep.equal([]);
        const bodies = Object.fromEntries(
          network.requests.map((request) => [
            request.url.split("/")[4],
            JSON.parse(requestBodyText(request)).status,
          ]),
        );
        expect(bodies).to.deep.equal({ [ALPHA]: "reading", [BETA]: "completed", [GAMMA]: null });
      },
    );

    signOut();
  });

  suite.test("collections: a failed change is reported by id, not thrown", async () => {
    signIn();

    await withFakeNetwork(
      [
        [`/manga/${BETA}/status`, { status: 500 }],
        [/\/manga\/[0-9a-f-]+\/status/, { body: { result: "ok" } }],
      ],
      async () => {
        const failures = await applyManagedCollectionChanges([
          change("ok", "add", ALPHA, undefined, "reading"),
          change("broken", "add", BETA, undefined, "reading"),
        ]);

        expect(failures.map((failure) => failure.changeId)).to.deep.equal(["broken"]);
      },
    );

    signOut();
  });

  suite.test("collections: nothing applied throws, as does being signed out", async () => {
    signIn();
    await withFakeNetwork([[/\/manga\/[0-9a-f-]+\/status/, { status: 500 }]], async () => {
      await rejectionOf(
        applyManagedCollectionChanges([change("a", "add", ALPHA, undefined, "reading")]),
      );
    });

    signOut();
    await withFakeNetwork([], async (network) => {
      await rejectionOf(getManagedCollectionItems([collection("reading")]));
      await rejectionOf(applyManagedCollectionChanges([]));
      expect(network.requests).to.have.lengthOf(0);
    });
  });
}
