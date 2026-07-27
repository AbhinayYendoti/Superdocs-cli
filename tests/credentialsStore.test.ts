import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getCredentialsDirectory,
  getCredentialsPath,
  hasCredentials,
  loadApiKey,
  removeApiKey,
  saveApiKey
} from "../src/config/credentialsStore.js";
import { loadConfig } from "../src/config/env.js";
import {
  formatFriendlyError,
  formatFriendlyHint,
  MissingApiKeyError
} from "../src/utils/errors.js";

describe("CredentialsStore", () => {
  it("resolves the OS-specific SuperDocs credentials directory", () => {
    const expected =
      process.platform === "win32"
        ? path.join(
            process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
            "SuperDocs"
          )
        : process.platform === "darwin"
          ? path.join(os.homedir(), "Library", "Application Support", "SuperDocs")
          : path.join(
              process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
              "SuperDocs"
            );

    assert.equal(getCredentialsDirectory(), expected);
  });

  it("saves, loads, detects, and removes credentials.json", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-credentials-"));
    const credentialsPath = path.join(tempDir, "credentials.json");
    const previousPath = process.env.SUPERDOCS_CREDENTIALS_PATH;
    process.env.SUPERDOCS_CREDENTIALS_PATH = credentialsPath;

    try {
      assert.equal(getCredentialsPath(), credentialsPath);
      assert.equal(hasCredentials(), false);
      assert.equal(loadApiKey(), undefined);

      await saveApiKey("sk_test.with-hyphen_123");

      assert.equal(loadApiKey(), "sk_test.with-hyphen_123");
      assert.equal(hasCredentials(), true);
      assert.deepEqual(JSON.parse(await readFile(credentialsPath, "utf8")), {
        version: 1,
        apiKey: "sk_test.with-hyphen_123"
      });
      if (process.platform !== "win32") {
        assert.equal((await lstat(credentialsPath)).mode & 0o777, 0o600);
      }

      assert.equal(await removeApiKey(), true);
      assert.equal(await removeApiKey(), false);
      assert.equal(hasCredentials(), false);
    } finally {
      restoreEnv("SUPERDOCS_CREDENTIALS_PATH", previousPath);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not load credentials from the current working directory .env", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-no-cwd-env-"));
    const credentialsPath = path.join(tempDir, "credentials.json");
    const previousPath = process.env.SUPERDOCS_CREDENTIALS_PATH;
    const previousApiKey = process.env.SUPERDOCS_API_KEY;
    const previousCwd = process.cwd();

    process.env.SUPERDOCS_CREDENTIALS_PATH = credentialsPath;
    delete process.env.SUPERDOCS_API_KEY;

    try {
      await writeFile(path.join(tempDir, ".env"), 'SUPERDOCS_API_KEY="sk_cwd_env_key"\n', "utf8");
      await saveApiKey("sk_global_store_key");
      process.chdir(tempDir);

      const config = loadConfig();

      assert.equal(config.apiKey, "sk_global_store_key");
      assert.equal(config.credentialsPath, credentialsPath);
      assert.equal(config.keySource, "credentials-store");
    } finally {
      process.chdir(previousCwd);
      restoreEnv("SUPERDOCS_CREDENTIALS_PATH", previousPath);
      restoreEnv("SUPERDOCS_API_KEY", previousApiKey);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps flag and environment API keys as overrides", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-credentials-"));
    const previousPath = process.env.SUPERDOCS_CREDENTIALS_PATH;
    const previousApiKey = process.env.SUPERDOCS_API_KEY;
    process.env.SUPERDOCS_CREDENTIALS_PATH = path.join(tempDir, "credentials.json");

    try {
      await saveApiKey("sk_stored_key");

      process.env.SUPERDOCS_API_KEY = "sk_env_key";
      assert.equal(loadConfig().apiKey, "sk_env_key");
      assert.equal(loadConfig().keySource, "environment");

      assert.equal(loadConfig({ apiKey: "sk_flag_key" }).apiKey, "sk_flag_key");
      assert.equal(loadConfig({ apiKey: "sk_flag_key" }).keySource, "flag");
    } finally {
      restoreEnv("SUPERDOCS_CREDENTIALS_PATH", previousPath);
      restoreEnv("SUPERDOCS_API_KEY", previousApiKey);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not read stored credentials when flag or environment overrides are present", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-credentials-"));
    const previousPath = process.env.SUPERDOCS_CREDENTIALS_PATH;
    const previousApiKey = process.env.SUPERDOCS_API_KEY;
    process.env.SUPERDOCS_CREDENTIALS_PATH = path.join(tempDir, "credentials.json");

    try {
      await writeFile(process.env.SUPERDOCS_CREDENTIALS_PATH, "{not-json", "utf8");

      process.env.SUPERDOCS_API_KEY = "sk_env_key";
      assert.equal(loadConfig().apiKey, "sk_env_key");

      delete process.env.SUPERDOCS_API_KEY;
      assert.equal(loadConfig({ apiKey: "sk_flag_key" }).apiKey, "sk_flag_key");
    } finally {
      restoreEnv("SUPERDOCS_CREDENTIALS_PATH", previousPath);
      restoreEnv("SUPERDOCS_API_KEY", previousApiKey);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("throws a user-friendly authentication error when no credentials are available", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-credentials-"));
    const previousPath = process.env.SUPERDOCS_CREDENTIALS_PATH;
    const previousApiKey = process.env.SUPERDOCS_API_KEY;
    process.env.SUPERDOCS_CREDENTIALS_PATH = path.join(tempDir, "credentials.json");
    delete process.env.SUPERDOCS_API_KEY;

    try {
      let error: unknown;
      try {
        loadConfig();
      } catch (caught) {
        error = caught;
      }

      assert.ok(error instanceof MissingApiKeyError);
      assert.equal(
        formatFriendlyError(error),
        "No SuperDocs credentials found.\n\nRun:\nsuperdocs auth login"
      );
      assert.equal(formatFriendlyHint(error), undefined);
    } finally {
      restoreEnv("SUPERDOCS_CREDENTIALS_PATH", previousPath);
      restoreEnv("SUPERDOCS_API_KEY", previousApiKey);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects symlinked credential files", async (context) => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-credentials-"));
    const previousPath = process.env.SUPERDOCS_CREDENTIALS_PATH;
    const targetPath = path.join(tempDir, "target.json");
    const linkPath = path.join(tempDir, "credentials.json");
    process.env.SUPERDOCS_CREDENTIALS_PATH = linkPath;

    try {
      await writeFile(targetPath, "{}\n", "utf8");
      try {
        await symlink(targetPath, linkPath);
      } catch {
        context.skip("symlink creation is not available in this environment");
        return;
      }

      await assert.rejects(() => saveApiKey("sk_test"), /symlinked credentials file/u);
      assert.equal(await readFile(targetPath, "utf8"), "{}\n");
    } finally {
      restoreEnv("SUPERDOCS_CREDENTIALS_PATH", previousPath);
      await chmod(tempDir, 0o700).catch(() => {});
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
