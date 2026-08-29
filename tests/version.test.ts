import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function packageVersion(): Promise<string> {
  const raw = await readFile(path.join(projectRoot, "package.json"), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

/**
 * Matches static `import ... from "x"`, bare `import "x"`, and re-exporting
 * `export ... from "x"`. Type-only forms are skipped because they are erased.
 */
const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

/**
 * Walks only the *static* import graph from an entry module. Dynamic
 * `await import(...)` calls are deliberately not followed: deferring them is
 * exactly how the startup path is kept cheap.
 */
async function staticImportGraph(entry: string): Promise<Set<string>> {
  const visited = new Set<string>();
  const bareSpecifiers = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    let source: string;
    try {
      source = await readFile(current, "utf8");
    } catch {
      continue;
    }

    STATIC_IMPORT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STATIC_IMPORT.exec(source)) !== null) {
      const specifier = match[1];
      if (!specifier) {
        continue;
      }

      if (specifier.startsWith(".")) {
        // Source files import sibling modules with a .js extension.
        const resolved = path.resolve(path.dirname(current), specifier.replace(/\.js$/u, ".ts"));
        queue.push(resolved);
        continue;
      }

      if (!specifier.startsWith("node:")) {
        bareSpecifiers.add(specifier);
      }
    }
  }

  return bareSpecifiers;
}

describe("superdocs --version", () => {
  /**
   * The version was previously a string literal in `src/index.ts` and drifted
   * from package.json on the 1.0.1 bump, so the binary reported the wrong
   * version. This locks the two together.
   */
  it("matches the package version", async () => {
    const expected = await packageVersion();
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", path.join(projectRoot, "src", "index.ts"), "--version"],
      { cwd: projectRoot }
    );

    assert.equal(stdout.trim(), expected);
  });
});

describe("startup module graph", () => {
  /**
   * zod (~140 ms) and ora (~100 ms) dominated CLI startup because every command
   * module pulled them in at registration time, even for `--version`. They must
   * stay behind dynamic imports in the command action bodies.
   */
  it("does not eagerly load zod or ora when registering commands", async () => {
    const bare = await staticImportGraph(path.join(projectRoot, "src", "index.ts"));

    assert.ok(!bare.has("zod"), `zod is on the startup path (found: ${[...bare].join(", ")})`);
    assert.ok(!bare.has("ora"), `ora is on the startup path (found: ${[...bare].join(", ")})`);
  });

  it("still reaches the heavy modules through the SDK entry point", async () => {
    // Sanity check that the walker actually follows imports.
    const bare = await staticImportGraph(path.join(projectRoot, "src", "sdk", "index.ts"));
    assert.ok(bare.has("zod"));
  });
});
