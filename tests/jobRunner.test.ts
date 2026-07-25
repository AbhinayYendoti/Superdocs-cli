import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JobRunner } from "../src/services/jobRunner.js";
import type { ChatResponse, JobResponse } from "../src/types/api.js";
import type { ISuperDocsClient } from "../src/sdk/index.js";

describe("JobRunner", () => {
  it("continues polling through pending and in_progress until completed", async () => {
    const statuses: string[] = [];
    const client = createClient([
      {
        job_id: "job_1",
        status: "pending",
        progress: 0,
        result: null,
        error: null
      },
      {
        job_id: "job_1",
        status: "in_progress",
        progress: 75,
        result: null,
        error: null
      },
      {
        job_id: "job_1",
        status: "completed",
        result: { response: "Edited" },
        error: null
      }
    ]);
    const runner = new JobRunner(client);

    const result = await runner.runToCompletion("job_1", {
      mode: "poll",
      pollIntervalMs: 1,
      onProgress: (event) => statuses.push(event.message)
    });

    assert.equal(result.response, "Edited");
    assert.deepEqual(statuses, [
      "Applying edit (pending)",
      "Applying edit (in_progress)",
      "Applying edit (completed)"
    ]);
  });

  it("accepts succeeded as a successful terminal state", async () => {
    const client = createClient([
      {
        job_id: "job_2",
        status: "succeeded",
        result: { response: "Succeeded" },
        error: null
      }
    ]);
    const runner = new JobRunner(client);

    const result = await runner.runToCompletion("job_2", {
      mode: "poll",
      pollIntervalMs: 1
    });

    assert.equal(result.response, "Succeeded");
  });

  it("stops polling and surfaces failed job errors", async () => {
    const client = createClient([
      {
        job_id: "job_3",
        status: "failed",
        result: null,
        error: "Model limit reached"
      }
    ]);
    const runner = new JobRunner(client);

    await assert.rejects(
      () =>
        runner.runToCompletion("job_3", {
          mode: "poll",
          pollIntervalMs: 1
        }),
      /Model limit reached/u
    );
  });
});

function createClient(jobs: JobResponse[]): ISuperDocsClient {
  const queue = [...jobs];

  return {
    async getJob() {
      const next = queue.shift();
      if (!next) {
        throw new Error("No queued job response");
      }
      return next;
    },
    async cancelJob() {
      return {
        job_id: "cancelled",
        status: "cancelled",
        result: null,
        error: null
      };
    },
    async continueChat() {
      return { status: "continued" };
    },
    createStreamClient() {
      throw new Error("streaming should not be used in polling tests");
    },
    async health() {
      return { status: "ok" };
    },
    async listSessions() {
      return [];
    },
    async verifyAuthentication() {},
    async chat() {
      return {};
    },
    async chatAsync() {
      return { job_id: "job", session_id: "session", status: "pending" };
    },
    async uploadDocumentBase64() {
      return {};
    },
    async requestUploadUrl() {
      return { upload_id: "upload", upload_url: "https://example.test/upload" };
    },
    async uploadToSignedUrl() {},
    async processUploadedDocument() {
      return {};
    },
    async exportDocument() {
      return new Uint8Array();
    },
    getBaseUrl() {
      return "https://api.superdocs.app";
    },
    getApiKey() {
      return "sk_testtesttest";
    }
  };
}
