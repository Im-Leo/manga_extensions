# Changelog

## Unreleased

### Security

- MangaFox 1.2.0: page URLs are decoded from the site's packed scripts as data instead of by
  evaluating the scripts, so the extension no longer executes code served by the site.
- AsuraScans 1.2.0: session tokens moved from plain state to Paperback's secure storage; an existing
  session is migrated on launch and the old keys, including any stored password, are cleared. The
  sign-in request is now built with a JSON encoder, so a password containing `"` or `\` no longer
  corrupts it.

### Changed

- AsuraScans 1.2.0: signing in uses an explicit **Sign In** button instead of firing a request for
  every character typed into the password field, reports a wrong password in the form, and adds
  **Sign Out**. The access token is refreshed only near expiry, and concurrent refreshes are
  coalesced so rotation can no longer sign the user out.
- FlameComics 1.1.1: fewer duplicate requests. The three discover sections share one homepage
  payload, opening a title fetches its series data once for details and chapters, and concurrent
  callers share one build-id lookup and one catalog load.
- MangaFox 1.2.0: opening a title fetches its page once instead of once for details and again for
  chapters.
- MangaKakalot 1.1.1: the search form reuses the genre list for six hours instead of downloading
  the homepage each time it opens.
- AsuraScans 1.2.0: the genre and creator lists load in parallel, and the discover sections that
  need them share one load.

### Fixed

- AsuraScans 1.2.0: free chapters failed with "Access token expired" whenever a signed-in session
  could not be refreshed; only early access chapters now require the account.
- AsuraScans 1.2.0: progress set from the tracking form was never saved for a title without a
  bookmark, and opening the form created a bookmark before **Done** was tapped. The form is now
  read-only until **Done**, which creates the bookmark if needed, saves, and shows an error if the
  save fails.
- AsuraScans 1.2.0: bookmark lookups broke for titles containing `&`, `#` or `?`, which were sent
  unencoded.
- AsuraScans 1.2.0: cached search tags never expired, so genres and creators added on the site
  never appeared. They now refresh daily, keeping the old list if a refresh fails.
- MangaFox 1.2.0: a paginated chapter whose page failed to load opened with that page silently
  missing. Each page is retried, and a page that still fails now fails the chapter so the reader
  offers a retry. Pages from plainly served chapters are upgraded to https like covers.

- AsuraScans 1.1.1: opening a title or refreshing the library failed for some series. The series
  endpoint answers `{ series }` from its cache and `{ data: { series } }` on a cache miss; both
  shapes are now accepted.
- MangaFox 1.1.1: library items, Latest Updates and covers failed on iOS. The site now redirects
  slashless directory paths to plain http, which App Transport Security blocks, and serves cover
  URLs as http. Page URLs are now built in their canonical form and covers are upgraded to https.
- MangaKakalot 1.1.1: a chapter list that failed to load (an error payload, or a Cloudflare page
  instead of JSON) showed the title as having no chapters. It now reports the failure, so the app
  offers a retry.
- MangaFox 1.2.0: a page answering with an HTTP error status was parsed as if it were content,
  which surfaced as blank fields. It now fails with the status and the endpoint.
