/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import type { Chapter, SourceManga, TrackedMangaChapterReadAction } from "@paperback/types";
import { expect } from "chai";

import { TrackingForm } from "../AsuraScans/forms/progress.js";
import { AsuraSettingForm } from "../AsuraScans/forms/settings.js";
import { AsuraScans } from "../AsuraScans/main.js";
import * as session from "../AsuraScans/session.js";
import { processChapterReadActionQueue } from "../AsuraScans/tracking.js";
import { bookmarkSearchUrl } from "../AsuraScans/urls.js";
import { HttpError } from "../utils/network.js";
import { rejectionOf } from "./async.js";
import { requestBodyText, withFakeNetwork, type FakeRoute } from "./fakes/application.js";
import type { TestSuite } from "./suite.js";

const HOUR = 60 * 60 * 1000;

const USER = { id: 7, username: "reader", email: "reader@example.com" };

function tokens(access: string, refresh: string, expiresInMs: number): FakeRoute {
  return {
    body: {
      data: {
        access_token: access,
        refresh_token: refresh,
        expires_at: new Date(Date.now() + expiresInMs).toISOString(),
        user: USER,
      },
    },
  };
}

/** Signs in through the real code path, leaving a session that expires in `expiresInMs`. */
async function signInWith(expiresInMs: number): Promise<void> {
  await withFakeNetwork([["/auth/login", tokens("access-1", "refresh-1", expiresInMs)]], () =>
    session.signIn("reader@example.com", "secret"),
  );
}

const SOURCE_MANGA = {
  mangaId: "tom-and-jerry",
  mangaInfo: { primaryTitle: "Tom & Jerry #1?", additionalInfo: { id: "42" } },
} as unknown as SourceManga;

function readAction(id: string, chapterNum: number): TrackedMangaChapterReadAction {
  return { id, chapterNum, sourceManga: SOURCE_MANGA } as unknown as TrackedMangaChapterReadAction;
}

function chapter(early: boolean): Chapter {
  return {
    chapterId: "1",
    chapNum: 1,
    sourceManga: SOURCE_MANGA,
    additionalInfo: early ? { early_access: "true" } : undefined,
  } as unknown as Chapter;
}

const PAGES = {
  body: { data: { chapter: { pages: [{ url: "https://cdn.example.com/1.webp" }] } } },
};

/** Lets a form's fire-and-forget load settle; the runner's vm context has no timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/**
 * AsuraScans account flows: sign-in, token refresh, and progress sync.
 *
 * Each test signs out first. Sessions live in the runner's shared secure state,
 * so a leftover one would let a later test pass for the wrong reason.
 */
export function registerAsuraSessionTests(suite: TestSuite): void {
  suite.test("session: refreshes only within a minute of expiry", async () => {
    const now = Date.parse("2026-01-01T12:00:00Z");

    expect(session.needsRefresh("2026-01-01T13:00:00Z", now), "an hour left").to.equal(false);
    expect(session.needsRefresh("2026-01-01T12:00:30Z", now), "30 s left").to.equal(true);
    expect(session.needsRefresh("2026-01-01T11:00:00Z", now), "already expired").to.equal(true);
    expect(session.needsRefresh("", now), "unknown expiry").to.equal(true);
  });

  suite.test("signIn: sends real JSON, whatever the password contains", async () => {
    session.signOut();
    const password = 'p"a\\ss}{,';

    await withFakeNetwork([["/auth/login", tokens("a", "r", HOUR)]], async (network) => {
      await session.signIn("reader@example.com", password);

      const request = network.requests[0];
      expect(request?.method).to.equal("POST");
      expect(request?.headers?.["Content-Type"]).to.equal("application/json");
      expect(JSON.parse(requestBodyText(request!))).to.deep.equal({
        email: "reader@example.com",
        password,
      });
    });

    expect(session.isSignedIn()).to.equal(true);
    expect(session.currentUser()?.username).to.equal("reader");
  });

  suite.test("signIn: tokens go to secure state, never plain state", async () => {
    session.signOut();
    await signInWith(HOUR);

    for (const key of ["accessToken", "refreshToken", "user", "password", "session"]) {
      expect(Application.getState(key), `plain state "${key}"`).to.equal(undefined);
    }
    expect(Application.getSecureState("session")).to.not.equal(undefined);
  });

  suite.test("signIn: wrong credentials say so; an outage does not pose as one", async () => {
    session.signOut();

    await withFakeNetwork(
      [["/auth/login", { status: 401, body: { message: "nope" } }]],
      async () => {
        const error = await rejectionOf(session.signIn("reader@example.com", "wrong"));
        expect(error.message).to.contain("invalid email or password");
      },
    );

    await withFakeNetwork([["/auth/login", { status: 503, body: "down" }]], async () => {
      const error = await rejectionOf(session.signIn("reader@example.com", "secret"));
      expect(error).to.be.instanceOf(HttpError);
    });

    await withFakeNetwork([], async (network) => {
      await rejectionOf(session.signIn("", "secret"));
      expect(network.requests, "an empty field is caught before any request").to.have.lengthOf(0);
    });

    expect(session.isSignedIn()).to.equal(false);
  });

  suite.test("getAccessToken: a fresh token costs no request", async () => {
    session.signOut();
    await signInWith(HOUR);

    await withFakeNetwork([], async (network) => {
      expect(await session.getAccessToken()).to.equal("access-1");
      expect(network.requests).to.have.lengthOf(0);
    });
  });

  suite.test("getAccessToken: concurrent callers share one refresh", async () => {
    session.signOut();
    await signInWith(10_000);

    await withFakeNetwork(
      [["/auth/refresh", tokens("access-2", "refresh-2", HOUR)]],
      async (network) => {
        const results = await Promise.all([
          session.getAccessToken(),
          session.getAccessToken(),
          session.getAccessToken(),
        ]);

        expect(results).to.deep.equal(["access-2", "access-2", "access-2"]);
        expect(
          network.count("/auth/refresh"),
          "a second refresh would reuse a rotated token",
        ).to.equal(1);
        expect(JSON.parse(requestBodyText(network.requests[0]!))).to.deep.equal({
          refresh_token: "refresh-1",
        });
      },
    );

    await withFakeNetwork([], async (network) => {
      expect(await session.getAccessToken(), "the rotated token is stored").to.equal("access-2");
      expect(network.requests).to.have.lengthOf(0);
    });
  });

  suite.test("getAccessToken: only a rejected refresh signs the user out", async () => {
    session.signOut();
    await signInWith(10_000);

    await withFakeNetwork([["/auth/refresh", { status: 503 }]], async () => {
      await rejectionOf(session.getAccessToken());
    });
    expect(session.isSignedIn(), "an outage keeps the session").to.equal(true);

    await withFakeNetwork([["/auth/refresh", { status: 401 }]], async () => {
      const error = await rejectionOf(session.getAccessToken());
      expect(error.message).to.contain("session expired");
    });
    expect(session.isSignedIn(), "a rejection ends it").to.equal(false);
  });

  suite.test("migrateLegacySession: moves old tokens and clears plain state", async () => {
    session.signOut();
    Application.setState("legacy-access", "accessToken");
    Application.setState("legacy-refresh", "refreshToken");
    Application.setState("2099-01-01T00:00:00Z", "tokenExpiration");
    Application.setState(USER, "user");
    Application.setState("hunter2", "password");

    session.migrateLegacySession();

    for (const key of ["accessToken", "refreshToken", "tokenExpiration", "user", "password"]) {
      expect(Application.getState(key), `plain "${key}" cleared`).to.equal(undefined);
    }
    expect(session.currentUser()?.username).to.equal("reader");

    await withFakeNetwork([], async () => {
      expect(await session.getAccessToken(), "the old token still works").to.equal("legacy-access");
    });

    session.migrateLegacySession();
    expect(session.isSignedIn(), "running it again is harmless").to.equal(true);
  });

  suite.test(
    "getChapterDetails: a free chapter opens while the session cannot refresh",
    async () => {
      session.signOut();
      await signInWith(10_000);

      await withFakeNetwork(
        [
          ["/auth/refresh", { status: 503 }],
          ["/chapters/1", PAGES],
        ],
        async (network) => {
          const details = await AsuraScans.getChapterDetails(chapter(false));
          expect(details)
            .to.have.property("pages")
            .that.deep.equals(["https://cdn.example.com/1.webp"]);

          const reader = network.requests.find((request) => request.url.includes("/chapters/1"));
          expect(reader?.headers?.["Authorization"], "no token to send").to.equal(undefined);
        },
      );
    },
  );

  suite.test("getChapterDetails: early access asks for sign-in before any request", async () => {
    session.signOut();

    await withFakeNetwork([], async (network) => {
      const error = await rejectionOf(AsuraScans.getChapterDetails(chapter(true)));
      expect(error.message).to.equal(session.SIGN_IN_REQUIRED);
      expect(network.requests).to.have.lengthOf(0);
    });
  });

  suite.test("getChapterDetails: early access sends the token when signed in", async () => {
    session.signOut();
    await signInWith(HOUR);

    await withFakeNetwork([["/chapters/1", PAGES]], async (network) => {
      await AsuraScans.getChapterDetails(chapter(true));
      expect(network.requests[0]?.headers?.["Authorization"]).to.equal("Bearer access-1");
    });
  });

  suite.test("bookmarkSearchUrl: encodes the title", async () => {
    expect(bookmarkSearchUrl("Tom & Jerry #1?")).to.equal(
      "https://api.asurascans.com/api/me/bookmarks?search=Tom%20%26%20Jerry%20%231%3F",
    );
  });

  suite.test(
    "processChapterReadActionQueue: creates a missing bookmark, then records",
    async () => {
      session.signOut();
      await signInWith(HOUR);

      await withFakeNetwork(
        [
          ["/me/bookmarks", { body: { data: [], meta: { total: 0 } } }],
          ["/bookmarks/42/read/5", { body: {} }],
          ["/bookmarks/42", { status: 201, body: {} }],
        ],
        async (network) => {
          const result = await processChapterReadActionQueue([
            readAction("a", 3),
            readAction("b", 5),
          ]);

          expect(result.successfulItems.sort()).to.deep.equal(["a", "b"]);
          expect(result.failedItems).to.deep.equal([]);
          expect(
            network.requests.map((request) => `${request.method} ${request.url}`),
          ).to.deep.equal([
            "GET https://api.asurascans.com/api/me/bookmarks?search=Tom%20%26%20Jerry%20%231%3F",
            "POST https://api.asurascans.com/api/bookmarks/42",
            "POST https://api.asurascans.com/api/bookmarks/42/read/5",
          ]);
        },
      );
    },
  );

  suite.test("processChapterReadActionQueue: signed out, the queue is left intact", async () => {
    session.signOut();

    await withFakeNetwork([], async (network) => {
      const result = await processChapterReadActionQueue([readAction("a", 3)]);
      expect(result).to.deep.equal({ successfulItems: [], failedItems: [] });
      expect(network.requests).to.have.lengthOf(0);
    });
  });

  suite.test("TrackingForm: opening it writes nothing; Done creates and saves", async () => {
    session.signOut();
    await signInWith(HOUR);

    await withFakeNetwork(
      [
        ["/me/bookmarks", { body: { data: [], meta: { total: 0 } } }],
        ["/bookmarks/42", { body: {} }],
      ],
      async (network) => {
        const form = new TrackingForm(SOURCE_MANGA);
        form.formWillAppear();
        await settle();

        expect(form.getSections()[0]?.id, "loaded").to.equal("progress");
        expect(
          network.requests.map((request) => request.method),
          "viewing is read-only",
        ).to.deep.equal(["GET"]);

        await form.statusUpdate(["completed"]);
        await form.chapterProgressUpdate(12);
        await form.formDidSubmit();

        const writes = network.requests.slice(1);
        expect(writes.map((request) => request.method)).to.deep.equal(["POST", "PUT"]);
        expect(JSON.parse(requestBodyText(writes[1]!))).to.deep.equal({
          status: "completed",
          last_read_chapter: 12,
        });
      },
    );
  });

  suite.test("TrackingForm: a failed save throws, so the app keeps the form open", async () => {
    session.signOut();
    await signInWith(HOUR);

    await withFakeNetwork(
      [
        ["/me/bookmarks", { body: { data: [], meta: { total: 0 } } }],
        ["/bookmarks/42", { status: 500 }],
      ],
      async () => {
        const form = new TrackingForm(SOURCE_MANGA);
        form.formWillAppear();
        await settle();

        await rejectionOf(form.formDidSubmit());
      },
    );
  });

  suite.test("AsuraSettingForm: a failed sign-in shows its reason in the form", async () => {
    session.signOut();
    const form = new AsuraSettingForm();

    await withFakeNetwork([["/auth/login", { status: 422 }]], async () => {
      await form.updateEmail("  reader@example.com ");
      await form.updatePassword("wrong");
      await form.signIn();
    });

    const rows = form.getSections()[0]?.items.map((item) => item.id);
    expect(rows).to.include("signInError");

    await withFakeNetwork([["/auth/login", tokens("a", "r", HOUR)]], async (network) => {
      await form.updatePassword("secret");
      await form.signIn();
      expect(JSON.parse(requestBodyText(network.requests[0]!)).email, "trimmed").to.equal(
        "reader@example.com",
      );
    });

    expect(form.getSections()[0]?.id, "now signed in").to.equal("account");
    session.signOut();
  });
}
