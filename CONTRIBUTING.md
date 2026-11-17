# Contributing

How to build, test and release these extensions. For how the code is organized and why, see
[docs/architecture.md](docs/architecture.md).

## Setup

Requires Node 24 (`.nvmrc`, and `engines` in `package.json`), matching CI.

```
npm ci                 install the toolchain
npm run bundle         build every extension into bundles/
npm run serve          serve bundles/ over the LAN
npm test               offline test suite (no network)
npm run test:live      offline suite plus live network tests
npm run conformance    tsc + lint + format checks
npm run format         apply formatting
npm run logcat -- --ip <device-ip>    stream extension logs from a device
```

To try a build on a device: `npm run bundle`, `npm run serve`, add `http://<your-ip>:8080` as a
repository in Paperback, and reinstall the extension after each rebuild. Avoid
`paperback-cli serve --watch`; it hangs the server on rebuild.

## How a build is published

```
src/<Name>/*.ts  --paperback-cli bundle-->  bundles/  --CI-->  gh-pages  --HTTP-->  Paperback
```

A directory under `src/` is an extension if and only if it contains `pbconfig.ts`, which declares
its name, version, icon and capabilities. `tsc` only type-checks (`noEmit`); the bundler produces
the output.

Branches named `<major>.<minor>/<name>` (for example `0.9/stable`) are release branches. A push to
one runs the checks and then deploys to its own folder on `gh-pages`; deleting it removes that
folder. Any other branch deploys nothing.

## Checks

`npm run conformance` runs `tsc`, oxlint and oxfmt, and the pre-push hook runs it together with the
offline tests.

- **TypeScript** runs every strict flag except `exactOptionalPropertyTypes`, which would force a
  conditional spread at every paged return to distinguish `{ metadata: undefined }` from an absent
  cursor, a distinction Paperback does not make. Tests are type-checked with the sources, so a test
  calling a changed helper fails to compile instead of silently asserting nothing.
- **oxlint** gates on its `correctness`, `suspicious` and `perf` categories, with warnings denied.
  Each rule switched off in `.oxlintrc.json` carries its reason there.

## Tests

| Suite               | Network | Purpose                                                    |
| ------------------- | ------- | ---------------------------------------------------------- |
| `npm test`          | none    | parsers, request logic and contracts; must stay 100% green |
| `npm run test:live` | real    | end-to-end against the live sites; a failure means drift   |

Both run through `scripts/run-tests.mjs`, which exits non-zero when any test fails: `paperback-cli
test` reports failures but always exits 0, so the pre-push hook and CI depend on this script to
gate. Pass a source id to run one suite, as in `npm test -- MangaDex`.

Live tests are opt-in through `PB_LIVE=1`, which `run-tests.mjs --live` sets. The runner executes
bundles in a `vm` context without `process`, so `src/tests/live-tests.ts` reads the flag through
`globalThis`. MangaKakalot's live steps fail whenever Cloudflare challenges the runner; that is
expected.

The runner discovers only `src/tests/<SourceId>.ts`. Each suite calls `registerSourceTests` from
`suite.ts`, which adds the checks every source shares: unique interceptor ids, and the live
end-to-end pass or its recorded skip. Shared modules are tested from `shared-utils.ts` and
`shared-network.ts`, registered by one source's suite.

### Writing tests

- **Fixtures** live in `src/tests/fixtures/`. Hand-written fixtures contain only the elements a
  parser queries, so a failure points at one selector. URLs are built from the source's own
  constants (`DOMAIN` and similar), so a site move changes one line. Encoded payloads, such as the packed scripts
  in `mangafox-reader.ts`, are recorded byte-for-byte from the live site instead.
- **Network.** Code that makes its own requests runs under `withFakeNetwork`
  (`src/tests/fakes/application.ts`). It answers `Application.scheduleRequest` from a route table,
  records every request for assertions such as request counts, and throws on an unrouted request
  rather than reaching the network.
- **Failures.** Use `rejectionOf` (`src/tests/async.ts`) to capture an expected rejection; it fails
  the test if the promise resolves.
- **Isolation.** Caches belong to the extension instance; build a fresh extension per test to start
  cold. Sessions live in shared state, so account tests sign out first.
- **Assertions.** Prefer method-form chai assertions (`expect(x.length).to.equal(0)`) over property
  form (`.to.be.empty`), where a typo passes silently.
- **Characterization tests** in the MangaDex suite pin current behavior; if one fails after a
  refactor, the refactor is wrong.

## CI

| Workflow                 | Trigger                  | Does                                          |
| ------------------------ | ------------------------ | --------------------------------------------- |
| `conformance.yaml`       | pull request             | conformance checks                            |
| `test.yaml`              | pull request, daily      | offline suite; live suite daily, non-blocking |
| `bundle-deploy.yaml`     | push to a release branch | `verify` (conformance + offline), then deploy |
| `delete-branch-ext.yaml` | release branch deleted   | removes that branch's folder from `gh-pages`  |

Actions are pinned to commit SHAs and kept current by Dependabot. Only jobs that write to
`gh-pages` have write access.

## Releasing

- Bump the source's `version` in its `pbconfig.ts`; Paperback offers updates by version.
- Add an entry to `CHANGELOG.md` under **Unreleased**, naming the source and new version.
- Commits follow Conventional Commits (`fix(MangaFox): …`, `perf: …`).
- Every source file starts with the SPDX header:
  `/* SPDX-License-Identifier: GPL-3.0-or-later */`.
