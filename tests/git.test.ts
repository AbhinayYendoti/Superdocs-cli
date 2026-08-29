import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatGitContext, isGitDiffContent } from "../src/utils/git.js";

describe("formatGitContext", () => {
  it("returns undefined outside a repository", () => {
    assert.equal(formatGitContext({ isGitRepo: false, changedFiles: [] }), undefined);
  });

  it("includes root, branch, and changed files", () => {
    const context = formatGitContext({
      isGitRepo: true,
      rootPath: "/repo",
      branch: "feature/cli",
      changedFiles: ["src/a.ts", "docs/b.md"]
    });

    assert.ok(context);
    assert.ok(context.includes("/repo"));
    assert.ok(context.includes("feature/cli"));
    assert.ok(context.includes("src/a.ts"));
    assert.ok(context.includes("docs/b.md"));
  });

  it("reports a clean working tree", () => {
    const context = formatGitContext({ isGitRepo: true, rootPath: "/repo", changedFiles: [] });
    assert.ok(context?.includes("clean"));
  });

  it("caps the file list so a large tree cannot dominate the prompt", () => {
    const changedFiles = Array.from({ length: 120 }, (_, index) => `file-${index}.md`);
    const context = formatGitContext({ isGitRepo: true, changedFiles });

    assert.ok(context);
    const listed = context.split("\n").filter((line) => line.startsWith("  - file-"));
    assert.equal(listed.length, 50);
    assert.ok(context.includes("...and 70 more"));
    assert.ok(context.includes("Changed files (120)"));
  });

  it("omits the branch line when detached", () => {
    const context = formatGitContext({ isGitRepo: true, changedFiles: [] });
    assert.ok(!context?.includes("Current branch"));
  });
});

describe("isGitDiffContent", () => {
  it("detects unified diffs", () => {
    assert.equal(isGitDiffContent("diff --git a/x b/x\n--- a/x\n+++ b/x\n"), true);
  });

  it("does not treat prose as a diff", () => {
    assert.equal(isGitDiffContent("# Notes\n\nJust a document.\n"), false);
  });
});
