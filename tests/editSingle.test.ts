import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { executeSingleEditCycle } from "../src/commands/editSingle.js";
import type { EditCommandOptions } from "../src/types/commands.js";
import { MissingApiKeyError } from "../src/utils/errors.js";
import type { ILogger, Spinner } from "../src/utils/logger.js";

const servers: http.Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("executeSingleEditCycle", () => {
  it("exports and writes the session document when completed result has null updated_html", async () => {
    const requests: string[] = [];
    const exportedBody = Buffer.from("# Edited proposal\n\nFull replacement content.\n", "utf8");
    const server = http.createServer((request, response) => {
      requests.push(`${request.method ?? "GET"} ${request.url ?? "/"}`);

      if (request.method === "POST" && request.url === "/v1/documents/upload-base64") {
        respondJson(response, {
          session_id: "session_full",
          filename: "proposal.md",
          chunks_count: 1,
          version_id: "upload_version"
        });
        return;
      }

      if (request.method === "POST" && request.url === "/v1/chat/async") {
        respondJson(response, {
          job_id: "job_full",
          session_id: "session_full",
          status: "pending"
        });
        return;
      }

      if (
        request.method === "GET" &&
        /^\/v1\/chat\/cli-proposal-[a-z0-9]+\/stream\?job_id=job_full$/u.test(request.url ?? "")
      ) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream"
        });
        response.end(`event: final\ndata: ${JSON.stringify(completedJobResult())}\n\n`);
        return;
      }

      if (request.method === "GET" && request.url === "/v1/jobs/job_full") {
        respondJson(response, completedJobResult());
        return;
      }

      if (request.method === "POST" && request.url === "/v1/documents/export") {
        response.writeHead(200, {
          "Content-Type": "text/markdown"
        });
        response.end(exportedBody);
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ detail: "not found" }));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-edit-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "proposal.md");
    await writeFile(filePath, "# Draft\n\nOld content.\n", "utf8");

    await executeSingleEditCycle(
      filePath,
      { pollInterval: "2" },
      fakeCommand(addressPort(server)),
      "Rewrite this as a full proposal",
      new TestLogger(),
      new TestSpinner(),
      new AbortController().signal
    );

    assert.equal(await readFile(filePath, "utf8"), exportedBody.toString("utf8"));
    assert.deepEqual(requests, [
      "POST /v1/documents/upload-base64",
      "POST /v1/chat/async",
      requests[2] ?? "",
      "POST /v1/documents/export"
    ]);
    assert.match(
      requests[2] ?? "",
      /^GET \/v1\/chat\/cli-proposal-[a-z0-9]+\/stream\?job_id=job_full$/u
    );
  });

  it("cleans up the output lock when authentication config fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-edit-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "proposal.md");
    const credentialsPath = path.join(tempDir, "credentials.json");
    const previousCredentialsPath = process.env.SUPERDOCS_CREDENTIALS_PATH;
    const previousApiKey = process.env.SUPERDOCS_API_KEY;

    await writeFile(filePath, "# Draft\n\nOld content.\n", "utf8");
    process.env.SUPERDOCS_CREDENTIALS_PATH = credentialsPath;
    delete process.env.SUPERDOCS_API_KEY;

    try {
      await assert.rejects(
        () =>
          executeSingleEditCycle(
            filePath,
            { pollInterval: "2" },
            fakeCommand(undefined),
            "Rewrite this",
            new TestLogger(),
            new TestSpinner(),
            new AbortController().signal
          ),
        MissingApiKeyError
      );

      await assertNoLock(filePath);
    } finally {
      restoreEnv("SUPERDOCS_CREDENTIALS_PATH", previousCredentialsPath);
      restoreEnv("SUPERDOCS_API_KEY", previousApiKey);
    }
  });

  it("cleans up the output lock when the network request fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-edit-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "proposal.md");
    await writeFile(filePath, "# Draft\n\nOld content.\n", "utf8");

    await assert.rejects(() =>
      executeSingleEditCycle(
        filePath,
        { pollInterval: "2" },
        fakeCommand(9),
        "Rewrite this",
        new TestLogger(),
        new TestSpinner(),
        new AbortController().signal
      )
    );

    await assertNoLock(filePath);
  });

  it("cleans up the output lock when SuperDocs returns an invalid schema", async () => {
    const server = http.createServer((request, response) => {
      if (request.method === "POST" && request.url === "/v1/documents/upload-base64") {
        respondJson(response, {
          session_id: "session_full",
          filename: "proposal.md",
          chunks_count: 1,
          version_id: "upload_version"
        });
        return;
      }

      if (request.method === "POST" && request.url === "/v1/chat/async") {
        respondJson(response, {
          job_id: 123,
          session_id: "session_full",
          status: "pending"
        });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ detail: "not found" }));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-edit-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "proposal.md");
    await writeFile(filePath, "# Draft\n\nOld content.\n", "utf8");

    await assert.rejects(() =>
      executeSingleEditCycle(
        filePath,
        { pollInterval: "2" },
        fakeCommand(addressPort(server)),
        "Rewrite this",
        new TestLogger(),
        new TestSpinner(),
        new AbortController().signal
      )
    );

    await assertNoLock(filePath);
  });

  it("cleans up the output lock when the edit is aborted", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-edit-"));
    tempDirs.push(tempDir);
    const filePath = path.join(tempDir, "proposal.md");
    const abortController = new AbortController();
    await writeFile(filePath, "# Draft\n\nOld content.\n", "utf8");
    abortController.abort();

    await assert.rejects(
      () =>
        executeSingleEditCycle(
          filePath,
          { pollInterval: "2" },
          fakeCommand(9),
          "Rewrite this",
          new TestLogger(),
          new TestSpinner(),
          abortController.signal
        ),
      /cancelled/u
    );

    await assertNoLock(filePath);
  });
});

function completedJobResult(): unknown {
  return {
    status: "completed",
    result: {
      response: "Created the proposal",
      session_id: "session_full",
      document_changes: {
        updated_html: null,
        version_id: "85746612-aaa8-4426-9ce2-8c57d9470ade",
        changes_summary: "Created full document",
        requires_approval: null,
        pending_changes: null,
        concurrent_merges: null,
        changes: [{ operation: "create_full_document" }],
        chunk_diffs: [{ operation: "create_full_document" }]
      }
    }
  };
}

function fakeCommand(port: number | undefined): Command {
  return {
    optsWithGlobals() {
      return {
        ...(port === undefined ? {} : { apiKey: "sk_testtesttest" }),
        apiUrl: `http://127.0.0.1:${port ?? 9}`,
        quiet: true
      };
    }
  } as unknown as Command;
}

async function assertNoLock(filePath: string): Promise<void> {
  await assert.rejects(() => stat(`${filePath}.superdocs.lock`), { code: "ENOENT" });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function respondJson(response: http.ServerResponse, body: unknown): void {
  response.writeHead(200, {
    "Content-Type": "application/json"
  });
  response.end(JSON.stringify(body));
}

function addressPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  return address.port;
}

class TestSpinner implements Spinner {
  text = "";
  readonly isSpinning = false;

  start(text?: string): Spinner {
    if (text) this.text = text;
    return this;
  }

  succeed(text?: string): Spinner {
    if (text) this.text = text;
    return this;
  }

  fail(text?: string): Spinner {
    if (text) this.text = text;
    return this;
  }

  stop(): Spinner {
    return this;
  }
}

class TestLogger implements ILogger {
  readonly quiet = true;
  readonly verbose = false;
  readonly json = false;

  spinner(): Spinner {
    return new TestSpinner();
  }

  progress(): void {}
  info(): void {}
  success(): void {}
  warn(): void {}
  debug(): void {}
  error(): void {}
  writeJson(): void {}
}
