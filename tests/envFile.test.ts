import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { removeEnvValue, setEnvValue } from "../src/config/envFile.js";

describe("envFile", () => {
  it("writes quoted credentials with owner-only permissions", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-env-"));
    try {
      const envPath = path.join(tempDir, ".env");
      await setEnvValue("SUPERDOCS_API_KEY", "sk_test.with-hyphen_123", envPath);

      assert.equal(
        await readFile(envPath, "utf8"),
        'SUPERDOCS_API_KEY="sk_test.with-hyphen_123"\n'
      );
      if (process.platform !== "win32") {
        assert.equal((await lstat(envPath)).mode & 0o777, 0o600);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("updates and removes env values without touching comments", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-env-"));
    try {
      const envPath = path.join(tempDir, ".env");
      await writeFile(envPath, "# SUPERDOCS_API_KEY=old\nOTHER=value\n", "utf8");
      await setEnvValue("SUPERDOCS_API_KEY", "sk_new", envPath);
      await removeEnvValue("SUPERDOCS_API_KEY", envPath);

      assert.equal(await readFile(envPath, "utf8"), "# SUPERDOCS_API_KEY=old\nOTHER=value\n");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects symlinked credential files", async (context) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-env-"));
    try {
      const targetPath = path.join(tempDir, "target.env");
      const linkPath = path.join(tempDir, ".env");
      await writeFile(targetPath, "SAFE=value\n", "utf8");
      try {
        await symlink(targetPath, linkPath);
      } catch {
        context.skip("symlink creation is not available in this environment");
        return;
      }

      await assert.rejects(
        () => setEnvValue("SUPERDOCS_API_KEY", "sk_test", linkPath),
        /symlinked credentials file/u
      );
      assert.equal(await readFile(targetPath, "utf8"), "SAFE=value\n");
    } finally {
      await chmod(tempDir, 0o700).catch(() => {});
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
