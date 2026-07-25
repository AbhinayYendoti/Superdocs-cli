import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JobResponseSchema } from "../src/types/api.js";

describe("JobResponseSchema", () => {
  it("accepts pending jobs with null result and error fields", () => {
    const job = JobResponseSchema.parse({
      job_id: "job_pending",
      status: "pending",
      progress: 0,
      result: null,
      error: null
    });

    assert.equal(job.status, "pending");
    assert.equal(job.result, null);
    assert.equal(job.error, null);
  });

  it("accepts in-progress jobs with null result and error fields", () => {
    const job = JobResponseSchema.parse({
      job_id: "job_running",
      status: "in_progress",
      progress: 75,
      result: null,
      error: null
    });

    assert.equal(job.status, "in_progress");
    assert.equal(job.result, null);
    assert.equal(job.error, null);
  });

  it("requires a result for completed jobs", () => {
    const job = JobResponseSchema.parse({
      job_id: "job_done",
      status: "completed",
      result: { response: "Done" },
      error: null
    });

    assert.equal(job.status, "completed");
    assert.equal(job.result.response, "Done");
    assert.throws(() =>
      JobResponseSchema.parse({
        job_id: "job_bad",
        status: "completed",
        result: null,
        error: null
      })
    );
  });

  it("accepts completed full-document jobs with null inline HTML", () => {
    const job = JobResponseSchema.parse({
      job_id: "job_full_document",
      status: "completed",
      result: {
        response: "I created the full document.",
        session_id: "session_full_document",
        document_changes: {
          updated_html: null,
          version_id: "85746612-aaa8-4426-9ce2-8c57d9470ade",
          changes_summary: "Created a full replacement document",
          requires_approval: null,
          pending_changes: null,
          concurrent_merges: null,
          changes: [
            {
              operation: "create_full_document",
              chunk_id: "chunk_1"
            }
          ],
          chunk_diffs: [
            {
              operation: "create_full_document",
              chunk_id: "chunk_1"
            }
          ]
        }
      },
      error: null
    });

    assert.equal(job.status, "completed");
    assert.equal(job.result.document_changes?.updated_html, null);
    assert.equal(job.result.document_changes?.version_id, "85746612-aaa8-4426-9ce2-8c57d9470ade");
  });

  it("requires a result for succeeded jobs", () => {
    const job = JobResponseSchema.parse({
      job_id: "job_done",
      status: "succeeded",
      result: { response: "Done" },
      error: null
    });

    assert.equal(job.status, "succeeded");
    assert.equal(job.result.response, "Done");
  });

  it("accepts failed jobs with nullable errors", () => {
    const failed = JobResponseSchema.parse({
      job_id: "job_failed",
      status: "failed",
      result: null,
      error: { message: "Nope" }
    });
    const failedWithoutError = JobResponseSchema.parse({
      job_id: "job_failed_null",
      status: "failed",
      result: null,
      error: null
    });

    assert.equal(failed.status, "failed");
    assert.deepEqual(failed.error, { message: "Nope" });
    assert.equal(failedWithoutError.error, null);
  });
});
