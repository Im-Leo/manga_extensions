# Changelog

## Unreleased

### Fixed

- AsuraScans 1.1.1: opening a title or refreshing the library failed for some series. The series
  endpoint answers `{ series }` from its cache and `{ data: { series } }` on a cache miss; both
  shapes are now accepted.
- MangaFox 1.1.1: library items, Latest Updates and covers failed on iOS. The site now redirects
  slashless directory paths to plain http, which App Transport Security blocks, and serves cover
  URLs as http. Page URLs are now built in their canonical form and covers are upgraded to https.
- MangaKakalot 1.1.1: a chapter list that failed to load (an error payload, or a Cloudflare page
  instead of JSON) showed the title as having no chapters. It now reports the failure, so the app
  offers a retry.
- MangaFox 1.1.2: a page answering with an HTTP error status was parsed as if it were content,
  which surfaced as blank fields. It now fails with the status and the endpoint.
