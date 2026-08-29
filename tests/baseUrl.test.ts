import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BASE_URL, resolveBaseUrl } from "../src/config/env.js";

/**
 * `--api-url` used to carry a Commander default of the public API. That default
 * always populated `options.apiUrl`, so `SUPERDOCS_API_BASE_URL` was silently
 * ignored and self-hosted or development traffic went to api.superdocs.app.
 */
describe("resolveBaseUrl", () => {
  const original = process.env.SUPERDOCS_API_BASE_URL;

  function withEnv(value: string | undefined, run: () => void): void {
    if (value === undefined) {
      delete process.env.SUPERDOCS_API_BASE_URL;
    } else {
      process.env.SUPERDOCS_API_BASE_URL = value;
    }

    try {
      run();
    } finally {
      if (original === undefined) {
        delete process.env.SUPERDOCS_API_BASE_URL;
      } else {
        process.env.SUPERDOCS_API_BASE_URL = original;
      }
    }
  }

  it("falls back to the public API when nothing is set", () => {
    withEnv(undefined, () => {
      assert.equal(resolveBaseUrl({}), DEFAULT_BASE_URL);
    });
  });

  it("honours SUPERDOCS_API_BASE_URL", () => {
    withEnv("http://localhost:8080", () => {
      assert.equal(resolveBaseUrl({}), "http://localhost:8080");
    });
  });

  it("lets --api-url win over the environment", () => {
    withEnv("http://localhost:8080", () => {
      assert.equal(resolveBaseUrl({ apiUrl: "https://self.hosted" }), "https://self.hosted");
    });
  });

  it("trims whitespace and trailing slashes", () => {
    withEnv(undefined, () => {
      assert.equal(resolveBaseUrl({ apiUrl: "  https://self.hosted///  " }), "https://self.hosted");
    });
  });
});
