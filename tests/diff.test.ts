import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateUnifiedDiff } from "../src/utils/diff.js";

describe("diff.ts", () => {
  it("returns empty string when content is unchanged", () => {
    const text = "Hello world\nThis is a test.";
    const diff = generateUnifiedDiff(text, text, { color: false });
    assert.equal(diff, "");
  });

  it("generates unified diff for modified content", () => {
    const original = "Line 1\nLine 2\nLine 3";
    const modified = "Line 1\nLine 2 modified\nLine 3";
    const diff = generateUnifiedDiff(original, modified, { filename: "test.md", color: false });

    assert.ok(diff.includes("--- a/test.md"));
    assert.ok(diff.includes("+++ b/test.md"));
    assert.ok(diff.includes("-Line 2"));
    assert.ok(diff.includes("+Line 2 modified"));
  });

  it("handles empty original text", () => {
    const original = "";
    const modified = "New content";
    const diff = generateUnifiedDiff(original, modified, { filename: "new.txt", color: false });

    assert.ok(diff.includes("+New content"));
  });
});
