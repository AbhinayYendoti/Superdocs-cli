import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { StreamClient } from "../src/sdk/streamClient.js";

describe("StreamClient", () => {
  it("uses the documented chat session SSE endpoint", async () => {
    let requestUrl = "";
    const server = http.createServer((request, response) => {
      requestUrl = request.url ?? "";
      response.writeHead(200, {
        "Content-Type": "text/event-stream"
      });
      response.end('event: final\ndata: {"result":{"response":"Done"}}\n\n');
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");

      const client = new StreamClient({
        apiKey: "sk_testtesttest",
        baseUrl: `http://127.0.0.1:${addressPort(server)}`
      });
      const events = client.streamJobEvents("job_1", { sessionId: "session/one" });

      const event = await events.next();

      assert.equal(event.done, false);
      assert.equal(event.value.type, "final");
      assert.match(requestUrl, /^\/v1\/chat\/session%2Fone\/stream\?job_id=job_1$/u);
      assert.doesNotMatch(requestUrl, /\/jobs\/.*\/events/u);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("keeps one SSE request open while waiting for events", async () => {
    let requests = 0;
    const server = http.createServer((_, response) => {
      requests += 1;
      response.writeHead(200, {
        "Content-Type": "text/event-stream"
      });
      response.write("event: intermediate\n");
      setTimeout(() => {
        response.end(
          'id: 1\ndata: {"message":"Working"}\n\nevent: final\ndata: {"result":{"response":"Done"}}\n\n'
        );
      }, 50);
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");

      const client = new StreamClient({
        apiKey: "sk_testtesttest",
        baseUrl: `http://127.0.0.1:${addressPort(server)}`
      });
      const received = [];

      for await (const event of client.streamJobEvents("job_2", { sessionId: "session_2" })) {
        received.push(event.type);
      }

      assert.equal(requests, 1);
      assert.deepEqual(received, ["intermediate", "final"]);
    } finally {
      await closeServer(server);
    }
  });

  it("reconnects only after an unexpected close and sends last_sequence", async () => {
    const requestUrls: string[] = [];
    const server = http.createServer((request, response) => {
      requestUrls.push(request.url ?? "");
      response.writeHead(200, {
        "Content-Type": "text/event-stream"
      });

      if (requestUrls.length === 1) {
        response.end('id: 7\nevent: intermediate\ndata: {"message":"Still working"}\n\n');
        return;
      }

      response.end('id: 8\nevent: final\ndata: {"result":{"response":"Done"}}\n\n');
    });

    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");

      const client = new StreamClient({
        apiKey: "sk_testtesttest",
        baseUrl: `http://127.0.0.1:${addressPort(server)}`
      });
      const received = [];

      for await (const event of client.streamJobEvents("job_3", {
        sessionId: "session_3",
        reconnectDelayMs: 1,
        maxReconnects: 1
      })) {
        received.push(event.type);
      }

      assert.deepEqual(received, ["intermediate", "final"]);
      assert.equal(requestUrls.length, 2);
      assert.match(requestUrls[1] ?? "", /last_sequence=7/u);
    } finally {
      await closeServer(server);
    }
  });
});

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function addressPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  return address.port;
}
