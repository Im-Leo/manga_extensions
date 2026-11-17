/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Im-Leo */

import { ContentRating } from "@paperback/types";

/**
 * Content-rating classification, shared so every source answers the question the
 * same way.
 *
 * A rating is derived from the genres of the title in hand. Neither a
 * source-level constant nor a site's genre catalog substitutes: the first
 * asserts a rating the app cannot second-guess, the second describes the site
 * rather than the title. Matching is case-insensitive over one vocabulary
 * because sites disagree on casing and spelling.
 */

/**
 * Explicit sexual content.
 *
 * Both the display name and the URL slug of a genre end up here, so entries are
 * written in the normalized form {@link normalize} produces.
 */
const ADULT_GENRES = new Set([
  "adult",
  "erotica",
  "fetish",
  "hentai",
  "incest",
  "loli",
  "lolicon",
  "netorare",
  "netori",
  "pornographic",
  "r 18",
  "shota",
  "shotacon",
  "sm bdsm",
  "smut",
]);

/**
 * Suggestive or explicit-adjacent, but not explicit.
 *
 * Deliberately narrow. Broad descriptive tags — "violence", "bloody",
 * "suggestive" — appear on a large share of ordinary action titles, so treating
 * them as mature masks a library rather than the handful of covers worth hiding.
 */
const MATURE_GENRES = new Set(["ecchi", "gore", "mature", "sexual violence", "yaoi", "yuri"]);

/**
 * Folds a genre to one comparable form.
 *
 * Sites name the same genre two ways and both reach this module: a detail page
 * gives the display name ("Sexual Violence") while browsing gives the URL slug
 * ("sexual-violence"). Separators collapse to a single space so either matches.
 */
function normalize(genre: string): string {
  return genre.trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

/**
 * What a tile reports when the site exposes no genres for it.
 *
 * Never `EVERYONE`: an unknown tile that reads as safe is the outcome this
 * classification exists to prevent. Opening the title replaces it with the real
 * rating, so the cost of being wrong here is a blurred safe cover.
 */
export const UNRATED_LISTING_DEFAULT = ContentRating.MATURE;

/**
 * An unrecognized genre yields `EVERYONE`, so a new one cannot start hiding titles. No genres at
 * all is not evidence of safety, so it yields `UNRATED_LISTING_DEFAULT`.
 */
export function rateContent(genres: Iterable<string> | undefined): ContentRating {
  let rating: ContentRating | undefined;
  for (const genre of genres ?? []) {
    const normalized = normalize(genre);
    // ADULT is terminal; a MATURE hit keeps scanning in case an adult genre follows.
    if (ADULT_GENRES.has(normalized)) return ContentRating.ADULT;
    if (MATURE_GENRES.has(normalized)) rating = ContentRating.MATURE;
    else rating ??= ContentRating.EVERYONE;
  }

  return rating ?? UNRATED_LISTING_DEFAULT;
}

/**
 * How many learned ratings survive a restart.
 *
 * Bounded because this lands in the source's persisted state: a reader who
 * browses for months would otherwise grow it without limit.
 */
const PERSISTED_RATING_LIMIT = 2000;

/**
 * Where a persisted cache reads and writes.
 *
 * Injectable so a test can inspect exactly what is written, and when, without
 * sharing `Application` state with every other test in the run.
 */
export interface RatingStore {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
}

const applicationStore: RatingStore = {
  read: (key) => Application.getState(key),
  write: (key, value) => Application.setState(value, key),
};

/**
 * Ratings learned from detail pages, reused by later listings.
 *
 * Scoped per extension, since bundles share no runtime. Unbounded in memory,
 * because a browsing session cannot realistically reach more than a few hundred
 * titles; only the persisted copy is capped.
 */
export class ContentRatingCache {
  private readonly ratings = new Map<string, ContentRating>();
  private loaded = false;
  private dirty = false;

  /**
   * @param storageKey persists the cache under this key. Without one the cache
   * lives for the session only, which is right for a source whose listings carry
   * genres and so never pay to resolve them.
   */
  constructor(
    private readonly storageKey?: string,
    private readonly store: RatingStore = applicationStore,
  ) {}

  remember(mangaId: string, rating: ContentRating): void {
    if (!mangaId) return;
    this.load();
    // Re-inserted so a re-learned title moves to the end and is the last to be
    // dropped by the persisted cap.
    this.ratings.delete(mangaId);
    this.ratings.set(mangaId, rating);
    this.dirty = true;
  }

  knows(mangaId: string): boolean {
    this.load();
    return this.ratings.has(mangaId);
  }

  /** The learned rating, or `fallback` for a title never opened. */
  recall(mangaId: string, fallback: ContentRating = UNRATED_LISTING_DEFAULT): ContentRating {
    this.load();
    return this.ratings.get(mangaId) ?? fallback;
  }

  /**
   * Writes the cache back, if it is persisted and has changed.
   *
   * Called once a batch of lookups finishes rather than per title: a listing
   * page resolves two dozen ratings, and each would otherwise be its own write.
   */
  flush(): void {
    if (!this.storageKey || !this.dirty) return;
    this.dirty = false;

    // Least recently learned go first; Map preserves insertion order.
    const entries = [...this.ratings.entries()].slice(-PERSISTED_RATING_LIMIT);
    this.store.write(this.storageKey, Object.fromEntries(entries));
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.storageKey) return;

    const stored = this.store.read(this.storageKey);
    if (!stored || typeof stored !== "object") return;

    for (const [mangaId, rating] of Object.entries(stored)) {
      if (isContentRating(rating)) this.ratings.set(mangaId, rating);
    }
  }
}

const CONTENT_RATINGS: ReadonlySet<unknown> = new Set(Object.values(ContentRating));

/** Persisted state outlives the code that wrote it, so a stored value is checked, not trusted. */
function isContentRating(value: unknown): value is ContentRating {
  return CONTENT_RATINGS.has(value);
}

/**
 * Detail requests allowed in flight at once.
 *
 * A source's rate limiter caps requests per second but not how many are
 * outstanding. Unbounded, a listing opens one connection per tile and the origin
 * answers with 5xx.
 */
const RESOLUTION_CONCURRENCY = 8;

/**
 * Resolves the rating of every tile the cache cannot already answer for.
 *
 * `learn` reads one title's detail page — normally the source's `getMangaDetails`, whose parser
 * fills the cache as a side effect. Owned by the extension instance, so calls made together, such
 * as every discover section on launch, share one lookup per title and one concurrency cap.
 */
export class RatingResolver {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly waiting: (() => void)[] = [];
  private active = 0;

  constructor(
    private readonly cache: ContentRatingCache,
    private readonly learn: (mangaId: string) => Promise<unknown>,
    private readonly concurrency: number = RESOLUTION_CONCURRENCY,
  ) {}

  async resolve(mangaIds: readonly string[]): Promise<void> {
    const unknown = [...new Set(mangaIds)].filter((id) => id !== "" && !this.cache.knows(id));
    await Promise.all(unknown.map((id) => this.inFlight.get(id) ?? this.start(id)));
    this.cache.flush();
  }

  private start(mangaId: string): Promise<void> {
    const lookup = (async () => {
      await this.acquire();
      try {
        await this.learn(mangaId);
      } catch {
        // One unreadable title keeps the default rather than emptying the grid.
      } finally {
        this.release();
        this.inFlight.delete(mangaId);
      }
    })();
    this.inFlight.set(mangaId, lookup);
    return lookup;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    await new Promise<void>((resume) => this.waiting.push(resume));
  }

  /** Hands the slot straight to the next waiter, so a newcomer cannot slip in and pass the cap. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}
