#!/usr/bin/env node
/**
 * Cross-platform test runner.
 *
 * `node --test tests/*.test.ts` depends on the *shell* expanding the glob.
 * bash and zsh do; PowerShell and cmd do not, so on Windows the literal
 * pattern reached Node and the run failed with:
 *
 *   Could not find 'D:\a\...\tests\*.test.ts'
 *
 * Node's own glob support in `--test` only arrived after our Node 20 floor, so
 * discovery happens here instead. Any `npm test` on any shell now behaves the
 * same way.
 *
 * Extra arguments are treated as substring filters on the test file name:
 *   npm test -- e2e
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(projectRoot, "tests");
const filters = process.argv.slice(2);

const files = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.ts"))
  .filter((name) => filters.length === 0 || filters.some((filter) => name.includes(filter)))
  .sort()
  .map((name) => path.join(testsDir, name));

if (files.length === 0) {
  console.error(
    filters.length > 0
      ? `No test files in tests/ matched: ${filters.join(", ")}`
      : "No *.test.ts files found in tests/."
  );
  process.exit(1);
}

const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: projectRoot,
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
