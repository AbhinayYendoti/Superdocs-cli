import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { computeBufferHash, resolveRealPath, watchFile } from "../src/utils/watcher.js";

const execFileAsync = promisify(execFile);

describe("computeBufferHash", () => {
  it("is stable and content-addressed", () => {
    const a = computeBufferHash(Buffer.from("hello"));
    assert.equal(a, computeBufferHash(Buffer.from("hello")));
    assert.notEqual(a, computeBufferHash(Buffer.from("hello ")));
  });
});

describe("resolveRealPath", () => {
  it("returns the input unchanged when it cannot be resolved", () => {
    const missing = path.join(os.tmpdir(), "superdocs-does-not-exist-a1b2c3");
    assert.equal(resolveRealPath(missing), missing);
  });

  it("leaves an already-real path alone", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "superdocs-watch-"));
    try {
      assert.equal(resolveRealPath(resolveRealPath(dir)), resolveRealPath(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Regression: `fs.watch` on an 8.3 short path ("RUNNER~1") makes libuv's Windows
 * backend abort the whole process:
 *
 *   Assertion failed: !_wcsnicmp(filename, dir, dirlen), src\win\fs-event.c:72
 *
 * That is a fast-fail (0xC0000409), not a catchable error, so `--watch` died
 * outright. It surfaced only on CI, because it needs a profile name longer than
 * eight characters to generate a short path at all.
 */
describe("watchFile on short (8.3) Windows paths", () => {
  it("expands a short path so libuv does not abort", async (context) => {
    if (process.platform !== "win32") {
      context.skip("8.3 short paths are Windows-only");
      return;
    }

    const dir = await mkdtemp(path.join(os.tmpdir(), "superdocs-shortpath-"));
    const filePath = path.join(dir, "doc.md");
    await writeFile(filePath, "# Doc\n", "utf8");

    // Prefer the ambient temp directory when it already contains a short
    // component -- that is the real-world shape (TEMP under C:\Users\RUNNER~1)
    // that crashed CI. Otherwise ask the OS to generate one, which many modern
    // volumes have disabled.
    let shortDir = /~\d/u.test(dir) ? dir : "";

    if (!shortDir) {
      try {
        const { stdout } = await execFileAsync(
          "cmd",
          ["/c", `for %I in ("${dir}") do @echo %~sI`],
          { windowsHide: true }
        );
        shortDir = stdout.trim();
      } catch {
        context.skip("could not query the short path form");
        await rm(dir, { recursive: true, force: true });
        return;
      }
    }

    if (!shortDir || !/~\d/u.test(shortDir)) {
      context.skip("this volume does not generate 8.3 short names");
      await rm(dir, { recursive: true, force: true });
      return;
    }

    assert.ok(!/~\d/u.test(resolveRealPath(shortDir)), `resolveRealPath should expand ${shortDir}`);

    // The real assertion is that this call does not abort the process.
    const watcher = watchFile({
      filePath: path.join(shortDir, "doc.md"),
      debounceMs: 10,
      onChange: () => {}
    });

    try {
      await writeFile(filePath, "# Doc\n\nchanged\n", "utf8");
      await new Promise((resolve) => setTimeout(resolve, 200));
    } finally {
      watcher.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
