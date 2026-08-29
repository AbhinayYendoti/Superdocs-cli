import http from "node:http";
import { once } from "node:events";

/**
 * A full fake SuperDocs API used by the end-to-end suite.
 *
 * Unlike the integration suite, which calls `executeSingleEditCycle` directly,
 * this backs a real `node dist/index.js` subprocess, so it has to implement
 * every endpoint the shipped binary can reach.
 */

export interface MockRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown> | undefined;
}

export interface MockServerOptions {
  /** Successive payloads for GET /v1/jobs/:id. The last one repeats. */
  jobSequence?: Record<string, unknown>[];
  /** Bytes returned by POST /v1/documents/export. */
  exportBody?: Buffer;
  /** Return the exported body based on how many exports have happened. */
  exportBodyFor?: (callIndex: number) => Buffer;
  /** Reject auth with 401 to exercise the credential error paths. */
  rejectAuth?: boolean;
  /** Serve job progress over SSE instead of forcing the polling fallback. */
  streamEvents?: Record<string, unknown>[];
  health?: string;
}

export interface MockServer {
  port: number;
  baseUrl: string;
  requests: MockRequest[];
  close(): Promise<void>;
  /** Requests reduced to "METHOD /path", with query strings stripped. */
  paths(): string[];
  bodyOf(method: string, pathname: string): Record<string, unknown> | undefined;
  count(method: string, pathname: string): number;
}

function completedJob(): Record<string, unknown> {
  return {
    job_id: "job_e2e",
    status: "completed",
    result: { response: "ok", session_id: "session_e2e" }
  };
}

async function readBody(
  request: http.IncomingMessage
): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return { __raw: raw };
  }
}

function json(response: http.ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export async function startMockServer(options: MockServerOptions = {}): Promise<MockServer> {
  const requests: MockRequest[] = [];
  const jobSequence = options.jobSequence ?? [completedJob()];
  let jobIndex = 0;
  let exportIndex = 0;

  const server = http.createServer((request, response) => {
    void (async () => {
      const method = request.method ?? "GET";
      const url = request.url ?? "/";
      const pathname = url.split("?")[0] ?? url;
      const isSigned = pathname.startsWith("/signed/");
      const body = method === "PUT" ? undefined : await readBody(request);

      requests.push({ method, url, headers: request.headers, body });

      // /health is the only unauthenticated endpoint; signed uploads carry
      // their own credentials in the URL.
      if (options.rejectAuth && pathname !== "/health" && !isSigned) {
        json(response, { detail: "Invalid API key" }, 401);
        return;
      }

      if (method === "GET" && pathname === "/health") {
        json(response, { status: options.health ?? "healthy" });
        return;
      }

      if (method === "GET" && pathname === "/v1/sessions") {
        json(response, { sessions: [{ session_id: "session_e2e", message_count: 1 }] });
        return;
      }

      if (method === "POST" && pathname === "/v1/documents/upload-base64") {
        json(response, { session_id: "session_e2e", filename: "doc.md", chunks_count: 1 });
        return;
      }

      if (method === "POST" && pathname === "/v1/uploads") {
        json(response, {
          upload_id: "upload_e2e",
          upload_url: `http://127.0.0.1:${port}/signed/upload_e2e`
        });
        return;
      }

      if (method === "PUT" && pathname === "/signed/upload_e2e") {
        for await (const _chunk of request) {
          void _chunk;
        }
        response.writeHead(200).end();
        return;
      }

      if (method === "POST" && pathname === "/v1/uploads/upload_e2e/process") {
        json(response, { upload_id: "upload_e2e", session_id: "session_e2e" });
        return;
      }

      if (method === "POST" && pathname === "/v1/chat/async") {
        json(response, { job_id: "job_e2e", session_id: "session_e2e", status: "pending" });
        return;
      }

      if (method === "GET" && pathname.endsWith("/stream")) {
        if (!options.streamEvents) {
          response.writeHead(404).end();
          return;
        }

        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        for (const [index, event] of options.streamEvents.entries()) {
          response.write(`id: ${index + 1}\n`);
          response.write(`event: ${String(event["type"] ?? "progress")}\n`);
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        response.end();
        return;
      }

      if (method === "GET" && pathname.startsWith("/v1/jobs/")) {
        const job = jobSequence[Math.min(jobIndex, jobSequence.length - 1)];
        jobIndex += 1;
        json(response, job);
        return;
      }

      if (method === "POST" && pathname.endsWith("/cancel")) {
        json(response, { job_id: "job_e2e", status: "cancelled" });
        return;
      }

      if (method === "POST" && pathname.endsWith("/continue")) {
        json(response, { job_id: "job_e2e", status: "in_progress" });
        return;
      }

      if (method === "POST" && pathname === "/v1/documents/export") {
        const payload = options.exportBodyFor
          ? options.exportBodyFor(exportIndex)
          : (options.exportBody ?? Buffer.from("# Edited\n\nRewritten body.\n", "utf8"));
        exportIndex += 1;
        response.writeHead(200, { "Content-Type": "text/markdown" });
        response.end(payload);
        return;
      }

      json(response, { detail: `unhandled ${method} ${pathname}` }, 404);
    })();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock server did not bind to a TCP port.");
  }
  const port = address.port;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    paths: () => requests.map((entry) => `${entry.method} ${entry.url.split("?")[0] ?? ""}`),
    bodyOf: (method, pathname) =>
      requests.find(
        (entry) => entry.method === method && (entry.url.split("?")[0] ?? "") === pathname
      )?.body,
    count: (method, pathname) =>
      requests.filter(
        (entry) => entry.method === method && (entry.url.split("?")[0] ?? "") === pathname
      ).length,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
