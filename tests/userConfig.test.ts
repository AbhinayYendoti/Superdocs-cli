import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  getUserConfigValue,
  listUserConfig,
  loadUserConfig,
  normalizeConfigKey,
  setUserConfigValue
} from "../src/config/userConfig.js";

describe("userConfig", () => {
  it("sets, gets, and lists config values in a JSON file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-config-"));
    const configPath = path.join(tempDir, "config.json");

    try {
      await setUserConfigValue("default-model", "pro", configPath);
      await setUserConfigValue("timeout", "30", configPath);
      await setUserConfigValue("verbose", "true", configPath);

      assert.deepEqual(await getUserConfigValue("default_model", configPath), {
        key: "default_model",
        value: "pro"
      });

      const entries = await listUserConfig(configPath);
      assert.equal(entries.find((entry) => entry.key === "timeout")?.value, "30");
      assert.equal(entries.find((entry) => entry.key === "verbose")?.value, "true");

      const raw = JSON.parse(await readFile(configPath, "utf8"));
      assert.equal(raw.SUPERDOCS_API_KEY, undefined);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes hyphenated keys", () => {
    assert.equal(normalizeConfigKey("response-mode"), "response_mode");
  });

  it("rejects unknown keys", () => {
    assert.throws(
      () => normalizeConfigKey("api-key"),
      /SuperDocs does not recognize the preference 'api-key'/u
    );
  });

  it("uses a friendly message when saved preferences cannot be read", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-config-"));
    const configPath = path.join(tempDir, "config.json");

    try {
      await writeFile(configPath, "{not-json", "utf8");
      await assert.rejects(
        () => loadUserConfig(configPath),
        /SuperDocs could not read your saved preferences/u
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
