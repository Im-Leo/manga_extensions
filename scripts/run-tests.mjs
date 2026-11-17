/* SPDX-License-Identifier: GPL-3.0-or-later */

/**
 * Runs the test suites and fails when any test fails.
 *
 * `paperback-cli test` reports failures but always exits 0, so on its own it cannot gate a push
 * or a deploy. This runs it, then reads the results file it writes and sets the exit code.
 *
 * Usage: `node scripts/run-tests.mjs [--live] [SourceId]`. `--live` enables the live network
 * tests through `PB_LIVE`, set here because `PB_LIVE=1 npm test` is not portable to Windows.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const live = args.includes("--live");
const sourceIds = args.filter((arg) => arg !== "--live");
const output = live ? "./bundles/tests-live.json" : "./bundles/tests.json";

const require = createRequire(import.meta.url);
const toolchain = dirname(require.resolve("@paperback/toolchain/package.json"));
const cli = join(toolchain, require("@paperback/toolchain/package.json").bin["paperback-cli"]);

rmSync(output, { force: true });

const run = spawnSync(
  process.execPath,
  [cli, "test", "--noConsole", "--output", output, ...sourceIds],
  { stdio: "inherit", env: live ? { ...process.env, PB_LIVE: "1" } : process.env },
);

if (run.error) {
  console.error(`Could not start paperback-cli: ${run.error.message}`);
  process.exit(1);
}

process.exit(run.status === 0 ? check(output) : (run.status ?? 1));

/** Returns 1 when the results are missing, empty, or record any failure. */
function check(path) {
  if (!existsSync(path)) return fail(`No results at ${path}; the suites did not run.`);

  const suites = Object.entries(JSON.parse(readFileSync(path, "utf8")));
  if (suites.length === 0) return fail(`No suites recorded in ${path}.`);

  const failures = [];
  let passed = 0;
  let skipped = 0;
  for (const [suite, data] of suites) {
    if (data.error) failures.push(`${suite}: ${data.error}`);
    for (const test of data.tests ?? []) {
      if (test.status === "pass") passed++;
      else if (test.status === "skip") skipped++;
      else failures.push(`${suite} > ${test.name}: ${test.error ?? test.status}`);
    }
    if (!data.error && !data.summary)
      failures.push(`${suite}: no summary; the suite did not finish`);
  }

  console.log(`Results: ${passed} passed, ${failures.length} failed, ${skipped} skipped.`);
  if (failures.length === 0) return 0;
  return fail(failures.map((line) => `  ${line}`).join("\n"));
}

function fail(message) {
  console.error(message);
  return 1;
}
