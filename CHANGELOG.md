# Changelog

## Unreleased

### Changed

- All sources: ratings are reported on one 0–1 scale. MangaFox and MangaKakalot scores are scaled
  from the site's own scale, AsuraScans now reports the score its API sends, and FlameComics, which
  has no score, reports none instead of the lowest rating.
- All sources: a title whose payload carries no genres is shown as Mature until its genres are
  known, instead of as safe for everyone.
- MangaKakalot 1.3.0: the source is declared Mature, like MangaFox, since it hosts adult genres.
- MangaDex 1.2.0: Skip by New Chapters, Skip by Unread Chapters and Skip by Status apply with
  Optimized Updates off too; before, the form reported titles as skipped while every one was
  updated.
- MangaDex 1.2.0: fewer requests. Opening a title fetches its details once instead of again for its
  chapters, the chapter aggregate is requested only for completed titles, and library titles
  without chapters in your languages no longer cost an extra request on every update.
- MangaKakalot 1.3.0: discover sections look up each unrated title once, with one cap on concurrent
  requests, instead of once per section with up to 32 requests at a time.
- AsuraScans 1.3.0: opening a tracked title fetches its chapter list once, and refreshing the search
  filters no longer downloads the author and artist lists.
- MangaDex 1.2.0: the author and group filters accept a MangaDex link as well as a bare id.
  "Romanized Title Shown In" is now "Translated Title Shown In", and the group block list says it
  hides nothing while Group Blocking is off.
- AsuraScans 1.3.0: the redundant "All" choice is gone from the status and type filters. FlameComics
  1.2.0: the category AND/OR choice reads "All of them" / "Any of them" under a header.
- CI: a failing test now fails the pre-push hook, pull request checks and the deploy gate; before,
  the test run always reported success. Pull requests and deploys share one checks workflow, which
  also builds the bundle.

### Fixed

- FlameComics 1.2.0: filtering by type, status, year, language or country by any value with a space
  or punctuation, such as "South Korea", returned nothing.
- FlameComics 1.2.0: the Random sort reshuffled on every page, so later pages repeated some titles
  and skipped others.
- FlameComics 1.2.0: chapters stored by older versions, whose ids do not name the series, failed to
  open.
- AsuraScans 1.3.0: searches and genre, status and type tiles listed the least recently updated
  series first.
- AsuraScans 1.3.0: titles whose payload has no genres failed to open.
- AsuraScans 1.3.0: search and discover results repeated or skipped titles when the site returned a
  short page, and a discover listing with no data failed.
- AsuraScans 1.3.0: the Latest Updates and Popular carousels could show a different cover than
  search for the same title.
- AsuraScans 1.3.0 and FlameComics 1.2.0: synopses showed raw markup and undecoded entities such as
  `&#8217;`.
- MangaKakalot 1.3.0: every title reported a rating of 0, because the site changed how it shows
  scores.
- MangaKakalot 1.3.0: Latest Updates tiles could not open their latest chapter.
- MangaKakalot 1.3.0: a chapter page without reader images opened as a blank reader; it now fails so
  the app offers a retry.
- MangaKakalot 1.3.0: searching for a title made only of spaces or punctuation returned an error
  page; it now browses instead.
- MangaKakalot 1.3.0: a title the site has removed now says so and should be migrated, as MangaFox
  does, instead of failing with a bare request error.
- MangaFox 1.3.0: where chapter numbering restarts each volume, chapters sharing a number could not
  all be opened. Those chapters are now told apart by volume; other chapters keep their ids, so
  reading progress is unaffected. Chapters also report their volume.
- MangaFox 1.3.0: titles whose id contains a dot or similar characters listed no chapters.
- MangaFox 1.3.0: older chapters dated like "Sep 09,2015" could get an invalid date.
- MangaFox 1.3.0: page requests were sent with two Referer headers.
- MangaDex 1.2.0: blocked scanlation groups still appeared in Latest Updates.
- MangaDex 1.2.0: Latest Updates and `usr:` searches showed a title twice when its chapters spanned
  two pages.
- MangaDex 1.2.0: pasting a title's link or id found nothing when it had no chapters in your
  languages.
- MangaDex 1.2.0: search subtitles were blank when a title's newest chapter was in another language.
- MangaDex 1.2.0: paging far through an unfiltered group search showed "No results found".
- MangaDex 1.2.0: update skips did not apply to library titles still stored under a legacy numeric
  id.
- MangaDex 1.2.0: the session form kept showing an ended session after a token refresh found it
  gone.

## 2026-11-16

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
- MangaKakalot 1.2.0: the search form reuses the genre list for six hours instead of downloading
  the homepage each time it opens.
- AsuraScans 1.2.0: the genre and creator lists load in parallel, and the discover sections that
  need them share one load.
- AsuraScans 1.2.0: early access chapters are no longer listed. The site locks them for readers
  until they unlock for everyone, and signing in does not change that, so they could only fail to
  open. The Show Upcoming Chapters setting that listed them is removed.
- CI: a release branch deploys only after conformance and the offline suite pass on that commit.
  Workflow actions are pinned to commit SHAs, kept current by Dependabot, and jobs that do not
  publish run with read-only access.
- MangaDex 1.1.2: library sync uses Paperback's redesigned collection API. Reading statuses are
  mutually exclusive, a change that fails is reported on its own instead of failing the whole sync,
  and loading several collections costs one status request instead of one per collection.
- MangaDex 1.1.1: request errors name the source. Restoring default settings is driven by one list
  of every setting, so none can be left out.

### Fixed

- AsuraScans 1.2.0: free chapters failed with "Access token expired" whenever a signed-in session
  could not be refreshed. Reading a free chapter no longer depends on the session.
- AsuraScans 1.2.0: progress set from the tracking form was never saved for a title without a
  bookmark, and opening the form created a bookmark before **Done** was tapped. The form is now
  read-only until **Done**, which creates the bookmark if needed, saves, and shows an error if the
  save fails.
- AsuraScans 1.2.0: with Show Upcoming Chapters on, opening a title that had an early access
  chapter crashed the app, because that chapter was dated at its future unlock time. Chapters are
  now never dated in the future.
- AsuraScans 1.2.0: opening a locked chapter failed with "undefined is not an object". A locked
  chapter still stored by the app now reports when it unlocks for everyone.
- AsuraScans 1.2.0: opening a title while signed in could crash the app. Reading progress was
  reported by throwing for a title that is not bookmarked, and by naming a chapter that does not
  exist for one that is. Missing progress now reports as none, and the last-read chapter is the
  title's real chapter.
- AsuraScans 1.2.0: bookmark lookups broke for titles containing `&`, `#` or `?`, which were sent
  unencoded.
- AsuraScans 1.2.0: cached search tags never expired, so genres and creators added on the site
  never appeared. They now refresh daily, keeping the old list if a refresh fails.
- CI: deleting any branch ran the cleanup that removes a release from `gh-pages`, because the guard
  read the default branch instead of the deleted one and its `exit 0` ended only its own step. A
  branch named like a release folder would have deleted that release. The cleanup now runs only for
  deleted release branches, and the branch name no longer reaches the shell unquoted.
- MangaFox 1.2.0: a paginated chapter whose page failed to load opened with that page silently
  missing. Each page is retried, and a page that still fails now fails the chapter so the reader
  offers a retry. Pages from plainly served chapters are upgraded to https like covers.
- AsuraScans 1.1.1: opening a title or refreshing the library failed for some series. The series
  endpoint answers `{ series }` from its cache and `{ data: { series } }` on a cache miss; both
  shapes are now accepted.
- MangaFox 1.1.1: library items, Latest Updates and covers failed on iOS. The site now redirects
  slashless directory paths to plain http, which App Transport Security blocks, and serves cover
  URLs as http. Page URLs are now built in their canonical form and covers are upgraded to https.
- MangaKakalot 1.2.0: the site moved from mangakakalot.gg to kakamanga.com, where the page the
  Cloudflare check opened no longer exists, so the check showed no captcha. The source follows the
  move, and a check now opens on the page Cloudflare challenged. Library titles keep working.
- MangaKakalot 1.2.0: a chapter list that failed to load (an error payload, or a Cloudflare page
  instead of JSON) showed the title as having no chapters. It now reports the failure, so the app
  offers a retry.
- MangaFox 1.2.0: a page answering with an HTTP error status was parsed as if it were content,
  which surfaced as blank fields. It now fails with the status and the endpoint. A title the site
  has removed, which used to update silently with no new chapters, now says it is no longer on
  fanfox.net and should be migrated.
