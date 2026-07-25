import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactSecrets } from "../src/utils/redact.js";

describe("redact.ts", () => {
  it("redacts sk_ API keys", () => {
    const text = "Using key sk_live_123456789abc.with-hyphen for auth";
    const redacted = redactSecrets(text);
    assert.equal(redacted, "Using key [redacted] for auth");
  });

  it("redacts JSON API key fields", () => {
    const text = '{"apiKey":"sk_live_123.with-hyphen","ok":false}';
    const redacted = redactSecrets(text);
    assert.equal(redacted, '{"apiKey":"[redacted]","ok":false}');
  });

  it("redacts Bearer tokens in headers", () => {
    const text = "Authorization: Bearer secret_token_xyz";
    const redacted = redactSecrets(text);
    assert.equal(redacted, "Authorization: Bearer [redacted]");
  });

  it("leaves normal text unchanged", () => {
    const text = "This is a normal log message without secrets.";
    const redacted = redactSecrets(text);
    assert.equal(redacted, text);
  });
});
