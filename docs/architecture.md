# Architecture

How the extensions are organized, and the rules they share.

## Bundling

`paperback-cli` inlines each extension's entire import graph into one self-contained file.
Extensions share no runtime and cannot affect one another, and code in `src/utils/` is copied into
every bundle that imports it, so one edit there reaches several sources at once.

## Source layout

Every extension follows the same layering:

| File          | Responsibility                                    |
| ------------- | ------------------------------------------------- |
| `pbconfig.ts` | manifest only                                     |
| `models.ts`   | domain types and site constants                   |
| `network.ts`  | interceptor and request helpers                   |
| `parsers.ts`  | raw HTML/JSON into Paperback domain objects       |
| `reader.ts`   | page-image extraction, where a site obfuscates it |
| `urls.ts`     | one named builder per endpoint                    |
| `forms/`      | settings and advanced-search forms                |
| `main.ts`     | the `ExtensionImpl`, wiring only                  |

`main.ts` reads as a table of contents; parsing logic does not belong there. `network.ts` exists
only where a source needs its own request helpers. URLs are built by named functions in `urls.ts`
because a URL built inline in an `async` method can only be checked by making the request.

Sources add modules for responsibilities the others lack:

| Source      | Module        | Owns                                                                         |
| ----------- | ------------- | ---------------------------------------------------------------------------- |
| AsuraScans  | `session.ts`  | the account: secure-state tokens, refreshed near expiry, never twice at once |
| AsuraScans  | `tracking.ts` | bookmark and progress sync; `forms/progress.ts` is only its UI               |
| AsuraScans  | `tags.ts`     | search tags persisted for a day                                              |
| FlameComics | `network.ts`  | `_next/data` routes under the site's rotating build id                       |
| MangaFox    | `unpack.ts`   | decoding the packed scripts that carry page URLs                             |

MangaDex is several times the size of the others and is split further, so that no module answers
more than one question:

| Module                                         | Owns                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `state/`                                       | persisted settings, one file per area, re-exported from `state/index.ts`                                                                 |
| `search/`                                      | `filters.ts` (form selections into query options), `fetchers.ts` (the requests behind a page), `by-prefix.ts` (`usr:` and `list:` feeds) |
| `ratings.ts`, `relationships.ts`               | the rating vocabularies, and navigation of the `relationships` array                                                                     |
| `chapters.ts`, `chapter-feed.ts`, `updates.ts` | reading a feed, the manga inlined on each chapter, and the library-update flow                                                           |

## Shared utilities

| Module              | Purpose                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `network.ts`        | request helpers; non-2xx and malformed bodies throw, naming the endpoint        |
| `interceptor.ts`    | `Referer`, user agent and Cloudflare challenges, resolved on the challenged URL |
| `cache.ts`          | `singleFlight` and `TtlCache`, which coalesce requests made together            |
| `content-rating.ts` | the rating classifier and the cache of ratings learned from detail pages        |
| `url-builder/`      | query-string building for the AsuraScans API                                    |

Readers fail loudly: an error page or a non-JSON body becomes an error the app can offer to retry,
never an empty shelf or an empty chapter list.

The app asks for the same data several times at once, such as every discover section on launch, or
details and chapters when a title opens. Caches owned by the extension instance give those callers
one request between them.

## Rate limiting

Each source declares a `BasicRateLimiter` in its `main.ts`. All set `ignoreImages: true`, so cover
and page images bypass the budget; only API and page requests are paced.

| Source       | Requests/sec | Basis                               |
| ------------ | ------------ | ----------------------------------- |
| FlameComics  | 10           | plain JSON endpoints, no protection |
| AsuraScans   | 6            | tolerant CDN                        |
| MangaDex     | 5            | the documented public API limit     |
| MangaFox     | 12           | measured against the site           |
| MangaKakalot | 8            | measured against the site           |

**MangaKakalot** is the one Cloudflare-protected source, and a re-triggered challenge fails it
closed rather than slowing it, so its limit stays below what the site absorbed. Cloudflare
challenges its search but not its listings, details or chapters, and the measurement comes from
listings; if the source starts failing closed on device, this limit is the first thing to lower.

**MangaFox's** limit governs how fast a chapter opens. A paginated chapter needs one
`chapterfun.ashx` request per page, behind a single-use key, so `reader.ts` requests page 1 alone
and the remaining pages together. The site answered 45 concurrent page requests in about half a
second.

Page URLs arrive inside Dean Edwards-packed scripts, which `unpack.ts` decodes as data; nothing the
site sends is evaluated. Each page gets three attempts, and a page that still fails fails the
chapter.

## Content ratings

Paperback blurs artwork by rating, so a wrong rating is a privacy problem rather than a cosmetic
one. `src/utils/content-rating.ts` enforces two rules:

**A rating is derived from the title in hand, never asserted for a whole source.** A blanket
`EVERYONE` tells the app adult artwork is safe, and no user setting can override it. Rating from a
site's genre catalog fails the other way, since the catalog always contains "Adult".

**Unknown never reads as safe.** MangaFox and MangaKakalot listings carry only title, cover and
latest chapter. Such tiles report `UNRATED_LISTING_DEFAULT` (`MATURE`), so the cost of not knowing
is a blurred safe cover rather than exposed adult artwork.

| Source                  | Where the rating comes from                                       |
| ----------------------- | ----------------------------------------------------------------- |
| MangaDex                | the API's own `contentRating`                                     |
| AsuraScans, FlameComics | `genres[]` / `categories`+`tags`, present on listings and details |
| MangaFox, MangaKakalot  | detail genres; genre-browse pages; otherwise the default          |

Genres reach the classifier as display names ("Sexual Violence") and as URL slugs
("sexual-violence"), so separators are folded before matching. Browsing a genre such as
`/genre/adult` is evidence about every tile on that page, but only a genre that raises the rating
counts. `ContentRatingCache` remembers what detail pages teach, so a title moves from the default to
its real rating once opened.

**MangaKakalot resolves listing tiles eagerly.** It reads the detail page of every unrated tile
before returning a listing, through a bounded pool, because the rate limiter caps requests per
second but not how many are outstanding. Its learned ratings persist across launches, capped and
written once per batch.

**MangaFox does not.** Its listings carry 70 tiles and its detail pages are about 366 KB, roughly
24 MB per carousel, which is not a reasonable cost on a phone. A MangaFox tile therefore stays
`MATURE` until its title has been opened once.

Paperback masks grid tiles by rating but not the featured hero carousel, so MangaKakalot declares no
`featured` section; a test pins that.
