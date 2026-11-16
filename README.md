# Manga Extensions

Five manga sources for [Paperback](https://paperback.moe) 0.9, published as a single extension
repository.

| Extension    | Site            | Notes                                                |
| ------------ | --------------- | ---------------------------------------------------- |
| AsuraScans   | asurascans.com  | Optional sign-in syncs reading progress              |
| FlameComics  | flamecomics.xyz | Manga and manhwa only; novels are not listed         |
| MangaDex     | mangadex.org    | Settings, collections and library sync               |
| MangaFox     | fanfox.net      |                                                      |
| MangaKakalot | mangakakalot.gg | Protected by Cloudflare; may ask you to pass a check |

The sources I read broke often (titles vanishing, blank covers, failing searches) and the
extensions I relied on were not updated fast enough to keep up, so I wrote these from scratch on
[Inkdex's extension template](https://github.com/inkdex/template-extensions).

## Installing

In Paperback, open **Settings → Extension Repositories**, add this repository, and install the
sources you want:

```
https://im-leo.github.io/manga_extensions/0.9/stable
```

## Using

### AsuraScans account

Signing in is optional and only syncs your reading progress; everything else works without it.
Early access chapters are not listed, because the site locks them until they unlock for everyone,
whether or not you are signed in.

1. Open the AsuraScans source settings.
2. Enter your email and password and tap **Sign In**. A wrong password is reported in the form.
3. **Sign Out** in the same place ends the session.

The password is sent once to sign in and is never stored; the session is kept in Paperback's secure
storage.

Reading progress for a title is edited from its tracking form and saved when you tap **Done**.
Cancelling leaves your bookmarks untouched.

## Troubleshooting

**Covers are blank after reinstalling an extension.** Restart the app. Reinstalling while Paperback
is running can leave the source unable to load images the library already tried, while search and
discover keep working. MangaKakalot is the most affected.

**Covers show a letter instead of artwork.** Paperback hides artwork whose content rating you have
not opted into; the letter is the rating's initial (`U` unrated, `M` mature). Under **Settings →
Content**, enable the ratings you want visible and turn off blurring for them.

**MangaKakalot asks for a Cloudflare check.** Complete it in the window Paperback opens. The result
is remembered across restarts.

**A MangaFox title fails with "no longer on fanfox.net".** The site removed the series, usually
because it was licensed. It will not return on MangaFox; migrate it to another source.

**A chapter fails to open.** Retry it. A chapter only opens once every page has loaded, so a
temporary failure shows as an error rather than a chapter with pages missing.

## Known limitations

- **FlameComics**: novels are not listed, there are no source settings, and search does not match
  alternative titles.
- **MangaKakalot**: detail covers can look soft, because the site serves only the resolution that
  was uploaded.
- **MangaFox**: titles in listings are shown as Mature until you open them once, because listings
  carry no genres. See [content ratings](docs/architecture.md#content-ratings).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, tests and the release process, and
[docs/architecture.md](docs/architecture.md) for how the sources are built. Changes are recorded in
[CHANGELOG.md](CHANGELOG.md).

## License

[GPL-3.0-or-later](LICENSE). The repository layout, toolchain configuration and CI workflows derive
from [Inkdex's extension template](https://github.com/inkdex/template-extensions).
