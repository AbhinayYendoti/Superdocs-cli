import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { SuperDocsClient } from "../src/sdk/SuperDocsClient.js";
import { SuperDocsError } from "../src/utils/errors.js";

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe("SuperDocsClient", () => {
  it("logs verbose HTTP and validation details with redaction", async () => {
    const logs: string[] = [];
    const secret = "sk_secret.with-hyphen_123";
    const server = http.createServer((_, response) => {
      response.writeHead(200, {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`
      });
      response.end(JSON.stringify({ apiKey: secret }));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const client = new SuperDocsClient({
      apiKey: "sk_testtesttest",
      baseUrl: `http://127.0.0.1:${addressPort(server)}`,
      debug: (message) => logs.push(message)
    });

    await assert.rejects(() => client.listSessions(), /Invalid input/u);

    const joined = logs.join("\n");
    assert.match(joined, /\[http\] request GET http:\/\/127\.0\.0\.1:\d+\/v1\/sessions\?limit=10/u);
    assert.match(joined, /\[http\] response GET .* -> 200 OK/u);
    assert.match(joined, /\[http\] response headers:/u);
    assert.match(joined, /raw JSON response body before ListSessionsResponseSchema validation/u);
    assert.match(joined, /validation failed for ListSessionsResponseSchema/u);
    assert.match(joined, /Zod validation errors/u);
    assert.match(joined, /\[redacted\]/u);
    assert.doesNotMatch(joined, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(joined, /Bearer sk_/u);
  });

  it("surfaces rate limits without waiting past the client timeout", async () => {
    const server = http.createServer((_, response) => {
      response.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "60"
      });
      response.end(JSON.stringify({ detail: "slow down" }));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const client = new SuperDocsClient({
      apiKey: "sk_testtesttest",
      baseUrl: `http://127.0.0.1:${addressPort(server)}`,
      timeoutMs: 1000,
      maxRetries: 2
    });

    const started = Date.now();
    await assert.rejects(
      () => client.listSessions(),
      (error) => {
        assert.equal(error instanceof SuperDocsError, true);
        assert.equal((error as SuperDocsError).status, 429);
        return true;
      }
    );
    assert.ok(Date.now() - started < 1000);
  });

  it("does not retry aborted signed uploads", async () => {
    let requests = 0;
    const server = http.createServer((_, response) => {
      requests += 1;
      setTimeout(() => response.end("ok"), 100);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const client = new SuperDocsClient({
      apiKey: "sk_testtesttest",
      timeoutMs: 500,
      maxRetries: 2
    });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () =>
        client.uploadToSignedUrl(
          `http://127.0.0.1:${addressPort(server)}/upload`,
          Buffer.from("large body"),
          "text/plain",
          controller.signal
        ),
      /aborted/u
    );
    assert.equal(requests, 0);
  });
});

function addressPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  return address.port;
}
