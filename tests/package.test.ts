import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

describe("package metadata", () => {
  it("is configured for public npm consumption", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));

    assert.equal(pkg.name, "superdocs-app-cli");
    assert.equal(pkg.bin.superdocs, "dist/index.js");
    assert.equal(pkg.type, "module");
    assert.equal(pkg.main, "./dist/sdk/index.js");
    assert.equal(pkg.types, "./dist/sdk/index.d.ts");
    assert.equal(pkg.exports["."].import, "./dist/sdk/index.js");
    assert.equal(pkg.repository.url, "git+https://github.com/AbhinayYendoti/Superdocs-cli.git");
    assert.equal(pkg.homepage, "https://github.com/AbhinayYendoti/Superdocs-cli#readme");
    assert.equal(pkg.bugs.url, "https://github.com/AbhinayYendoti/Superdocs-cli/issues");
    assert.equal(pkg.publishConfig.access, "public");
    assert.equal(pkg.publishConfig.provenance, undefined);
    assert.ok(pkg.files.includes("DESIGN.md"));
    assert.ok(pkg.keywords.includes("markdown"));
    assert.ok(pkg.keywords.includes("git"));
    assert.ok(pkg.engines.node.startsWith(">=20"));
    assert.ok(pkg.engines.npm.startsWith(">=10"));
    assert.doesNotMatch(pkg.description, /�|â/u);
  });
});
