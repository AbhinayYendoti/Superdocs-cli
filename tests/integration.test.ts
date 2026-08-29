import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { executeSingleEditCycle } from "../src/commands/editSingle.js";
import type { EditCommandOptions } from "../src/types/commands.js";
import {
  TestLogger,
  TestSpinner,
  addressPort,
  fakeCommand,
  readRequestJson,
  respondJson
} from "./helpers.js";

/**
 * End-to-end coverage of the upload -> chat -> job -> export -> write pipeline
 * against a real HTTP server. The unit suites stub `ISuperDocsClient`, so
 * without this the most failure-prone path in the CLI was never executed.
 */

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

interface MockState {
  requests: string[];
  chatBodies: Record<string, unknown>[];
  continueBodies: Record<string, unknown>[];
  uploadedBytes: Buffer | undefined;
  cancelled: boolean;
}

interface MockOptions {
  /** Job payloads returned by successive GET /v1/jobs/:id calls. */
  jobSequence?: Record<string, unknown>[];
  exportBody?: Buffer;
  /** Number of times POST /v1/chat/async should fail with 500 before succeeding. */
  chatFailures?: number;
}

function completedJob(): Record<string, unknown> {
  return {
    job_id: "job_int",
    status: "completed",
    result: { response: "done", session_id: "session_int" }
  };
}

async function startMockSuperDocs(
  options: MockOptions = {}
): Promise<{ port: number; state: MockState }> {
  const state: MockState = {
    requests: [],
    chatBodies: [],
    continueBodies: [],
    uploadedBytes: undefined,
    cancelled: false
  };

  const jobSequence = options.jobSequence ?? [completedJob()];
  const exportBody = options.exportBody ?? Buffer.from("# Edited\n\nNew body.\n", "utf8");
  let chatFailuresLeft = options.chatFailures ?? 0;
  let jobIndex = 0;

  const server = http.createServer((request, response) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    state.requests.push(`${method} ${url}`);

    void (async () => {
      // Streaming is intentionally unavailable so these tests exercise the
      // polling fallback, which is what CI and locked-down networks hit.
      if (method === "GET" && url.includes("/stream")) {
        response.writeHead(404).end();
        return;
      }

      if (method === "POST" && url === "/v1/documents/upload-base64") {
        const body = await readRequestJson(request);
        const base64 = typeof body["file_base64"] === "string" ? body["file_base64"] : "";
        state.uploadedBytes = Buffer.from(base64, "base64");
        respondJson(response, { session_id: "session_int", filename: "doc.md", chunks_count: 1 });
        return;
      }

      if (method === "POST" && url === "/v1/uploads") {
        respondJson(response, {
          upload_id: "upload_int",
          upload_url: `http://127.0.0.1:${addressPort(server)}/signed/upload_int`
        });
        return;
      }

      if (method === "PUT" && url === "/signed/upload_int") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(chunk as Buffer);
        }
        state.uploadedBytes = Buffer.concat(chunks);
        response.writeHead(200).end();
        return;
      }

      if (method === "POST" && url === "/v1/uploads/upload_int/process") {
        respondJson(response, { upload_id: "upload_int", session_id: "session_int" });
        return;
      }

      if (method === "POST" && url === "/v1/chat/async") {
        state.chatBodies.push(await readRequestJson(request));
        if (chatFailuresLeft > 0) {
          chatFailuresLeft -= 1;
          respondJson(response, { detail: "temporary" }, 500);
          return;
        }
        respondJson(response, {
          job_id: "job_int",
          session_id: "session_int",
          status: "pending"
        });
        return;
      }

      if (method === "GET" && url.startsWith("/v1/jobs/")) {
        const job = jobSequence[Math.min(jobIndex, jobSequence.length - 1)];
        jobIndex += 1;
        respondJson(response, job);
        return;
      }

      if (method === "POST" && url.endsWith("/cancel")) {
        state.cancelled = true;
        respondJson(response, { job_id: "job_int", status: "cancelled" });
        return;
      }

      if (method === "POST" && url.endsWith("/continue")) {
        state.continueBodies.push(await readRequestJson(request));
        respondJson(response, { job_id: "job_int", status: "in_progress" });
        return;
      }

      if (method === "POST" && url === "/v1/documents/export") {
        response.writeHead(200, { "Content-Type": "text/markdown" });
        response.end(exportBody);
        return;
      }

      respondJson(response, { detail: `unexpected ${method} ${url}` }, 404);
    })();
  });

  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return { port: addressPort(server), state };
}

async function makeTempFile(content: string, name = "doc.md"): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "superdocs-int-"));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function baseOptions(overrides: Partial<EditCommandOptions> = {}): EditCommandOptions {
  return { pollInterval: "1", ...overrides };
}

describe("integration: edit pipeline", () => {
  it("runs upload, job polling, export, and atomic write end to end", async () => {
    const { port, state } = await startMockSuperDocs({
      jobSequence: [
        { job_id: "job_int", status: "pending" },
        { job_id: "job_int", status: "in_progress" },
        completedJob()
      ]
    });
    const filePath = await makeTempFile("# Original\n\nOld body.\n");
    const logger = new TestLogger();

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Tighten this",
      logger,
      new TestSpinner()
    );

    assert.equal(await readFile(filePath, "utf8"), "# Edited\n\nNew body.\n");
    assert.ok(state.requests.includes("POST /v1/chat/async"));
    assert.ok(state.requests.includes("POST /v1/documents/export"));
    assert.equal(state.uploadedBytes?.toString("utf8"), "# Original\n\nOld body.\n");
  });

  it("uses the presigned upload path for documents above the inline threshold", async () => {
    const { port, state } = await startMockSuperDocs();
    const large = `# Big\n\n${"filler paragraph. ".repeat(9000)}\n`;
    const filePath = await makeTempFile(large);

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Summarise",
      new TestLogger(),
      new TestSpinner()
    );

    assert.ok(state.requests.includes("POST /v1/uploads"), "should request a signed URL");
    assert.ok(state.requests.includes("PUT /signed/upload_int"), "should PUT to the signed URL");
    assert.ok(state.requests.includes("POST /v1/uploads/upload_int/process"));
    assert.ok(!state.requests.includes("POST /v1/documents/upload-base64"));
    assert.equal(state.uploadedBytes?.toString("utf8"), large);
  });

  it("retries a 5xx on chat before succeeding", async () => {
    const { port, state } = await startMockSuperDocs({ chatFailures: 1 });
    const filePath = await makeTempFile("# Original\n\nOld body.\n");

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Fix typos",
      new TestLogger(),
      new TestSpinner()
    );

    const chatCalls = state.requests.filter((entry) => entry === "POST /v1/chat/async");
    assert.equal(chatCalls.length, 2, "one failure plus one retry");
    assert.equal(await readFile(filePath, "utf8"), "# Edited\n\nNew body.\n");
  });

  it("surfaces a failed job and leaves the original file untouched", async () => {
    const { port } = await startMockSuperDocs({
      jobSequence: [{ job_id: "job_int", status: "failed", error: "model unavailable" }]
    });
    const original = "# Original\n\nOld body.\n";
    const filePath = await makeTempFile(original);

    await assert.rejects(
      () =>
        executeSingleEditCycle(
          filePath,
          baseOptions(),
          fakeCommand(port),
          "Fix typos",
          new TestLogger(),
          new TestSpinner()
        ),
      /model unavailable/u
    );

    assert.equal(await readFile(filePath, "utf8"), original);
  });
});

describe("integration: --no-auto-continue", () => {
  const awaitingThenDone = [{ job_id: "job_int", status: "awaiting_approval" }, completedJob()];

  it("auto-continues by default", async () => {
    const { port, state } = await startMockSuperDocs({ jobSequence: awaitingThenDone });
    const filePath = await makeTempFile("# Original\n\nOld body.\n");

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Expand this",
      new TestLogger(),
      new TestSpinner()
    );

    assert.equal(state.continueBodies.length, 1);
    assert.equal(state.continueBodies[0]?.["continue"], true);
  });

  it("stops when --no-auto-continue is passed", async () => {
    // Commander represents `--no-auto-continue` as `autoContinue: false`.
    // Reading a `noAutoContinue` key instead made the flag a silent no-op.
    const { port, state } = await startMockSuperDocs({ jobSequence: awaitingThenDone });
    const filePath = await makeTempFile("# Original\n\nOld body.\n");

    await assert.rejects(
      () =>
        executeSingleEditCycle(
          filePath,
          baseOptions({ autoContinue: false }),
          fakeCommand(port),
          "Expand this",
          new TestLogger(),
          new TestSpinner()
        ),
      /paused this large edit/u
    );

    assert.deepEqual(
      state.continueBodies.map((body) => body["continue"]),
      [false],
      "must decline rather than silently continue"
    );
    assert.ok(state.cancelled, "the paused remote job should be cancelled, not abandoned");
  });
});

describe("integration: --approve", () => {
  it("defaults to unattended approval", async () => {
    const { port, state } = await startMockSuperDocs();
    const filePath = await makeTempFile("# Original\n\nOld body.\n");

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Fix typos",
      new TestLogger(),
      new TestSpinner()
    );

    assert.equal(state.chatBodies[0]?.["approval_mode"], "approve_all");
  });

  it("sends ask_every_time for --approve ask", async () => {
    const { port, state } = await startMockSuperDocs();
    const filePath = await makeTempFile("# Original\n\nOld body.\n");

    await executeSingleEditCycle(
      filePath,
      baseOptions({ approve: "ask" }),
      fakeCommand(port),
      "Fix typos",
      new TestLogger(),
      new TestSpinner()
    );

    assert.equal(state.chatBodies[0]?.["approval_mode"], "ask_every_time");
  });

  it("rejects an unknown approval mode", async () => {
    const { port } = await startMockSuperDocs();
    const filePath = await makeTempFile("# Original\n\nOld body.\n");

    await assert.rejects(
      () =>
        executeSingleEditCycle(
          filePath,
          baseOptions({ approve: "maybe" as "ask" }),
          fakeCommand(port),
          "Fix typos",
          new TestLogger(),
          new TestSpinner()
        ),
      /--approve must be one of: all, ask/u
    );
  });
});

describe("integration: --git context", () => {
  it("sends repository context with the instruction", async () => {
    const { port, state } = await startMockSuperDocs();
    const filePath = await makeTempFile("# Original\n\nOld body.\n");
    const gitContext = "Git context for this request:\n- Current branch: feature/x";

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Summarise the branch",
      new TestLogger(),
      new TestSpinner(),
      undefined,
      gitContext
    );

    const message = state.chatBodies[0]?.["message"];
    assert.equal(typeof message, "string");
    assert.ok((message as string).includes("Summarise the branch"));
    assert.ok(
      (message as string).includes("Current branch: feature/x"),
      "--git context must reach the API, not just the terminal"
    );
  });

  it("sends the bare prompt when --git is not used", async () => {
    const { port, state } = await startMockSuperDocs();
    const filePath = await makeTempFile("# Original\n\nOld body.\n");

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Summarise the branch",
      new TestLogger(),
      new TestSpinner()
    );

    assert.equal(state.chatBodies[0]?.["message"], "Summarise the branch");
  });
});

describe("integration: stream discipline", () => {
  it("writes the dry-run diff to stdout and status text to stderr", async () => {
    const { port } = await startMockSuperDocs();
    const filePath = await makeTempFile("# Original\n\nOld body.\n");
    const logger = new TestLogger();

    await executeSingleEditCycle(
      filePath,
      baseOptions({ dryRun: true }),
      fakeCommand(port),
      "Fix typos",
      logger,
      new TestSpinner()
    );

    const stdout = logger.stdoutText();
    assert.ok(stdout.includes("--- a/doc.md") || stdout.includes("+# Edited"), stdout);
    assert.ok(!stdout.includes("Dry run active"), "status text must not pollute stdout");
    assert.ok(logger.stderrText().includes("Dry run active"));
    assert.equal(await readFile(filePath, "utf8"), "# Original\n\nOld body.\n");
  });

  it("keeps session and job identifiers off stdout", async () => {
    const { port } = await startMockSuperDocs();
    const filePath = await makeTempFile("# Original\n\nOld body.\n");
    const logger = new TestLogger();

    await executeSingleEditCycle(
      filePath,
      baseOptions(),
      fakeCommand(port),
      "Fix typos",
      logger,
      new TestSpinner()
    );

    assert.equal(logger.stdoutText(), "", "in-place edits write nothing to stdout");
    assert.ok(logger.stderrText().includes("Session: "));
  });
});
