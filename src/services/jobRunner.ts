import { ChatResponseSchema, type ChatResponse, type JobResponse } from "../types/api.js";
import type { ISuperDocsClient } from "../sdk/index.js";
import { sleep } from "../utils/sleep.js";

export interface JobProgressEvent {
  type: "status_change" | "progress" | "reconnecting" | "error" | "complete";
  message: string;
  detail?: Record<string, unknown> | undefined;
}

export interface JobRunnerOptions {
  mode?: "stream" | "poll" | undefined;
  sessionId?: string | undefined;
  timeoutMs?: number | undefined;
  pollIntervalMs?: number | undefined;
  autoContinue?: boolean | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((event: JobProgressEvent) => void) | undefined;
  onContinuePrompt?: ((message: string) => void) | undefined;
  /**
   * Asked when SuperDocs pauses and auto-continue is off. Returning false
   * cancels the remote job instead of leaving it running server-side.
   */
  onApprovalRequired?: ((message: string) => Promise<boolean>) | undefined;
}

export class JobRunner {
  constructor(private readonly client: ISuperDocsClient) {}

  async runToCompletion(jobId: string, options: JobRunnerOptions = {}): Promise<ChatResponse> {
    const mode = options.mode ?? "stream";
    const timeoutMs = options.timeoutMs ?? 1800_000;
    const autoContinue = options.autoContinue ?? true;
    const signal = options.signal;

    this.checkAborted(signal, jobId);

    if (mode === "stream") {
      if (!options.sessionId) {
        options.onProgress?.({
          type: "status_change",
          message: "Session ID unavailable for streaming, falling back to polling"
        });
        return await this.runWithPolling(jobId, options, Date.now(), timeoutMs, autoContinue);
      }

      try {
        return await this.runWithStream(jobId, options, Date.now(), timeoutMs, autoContinue);
      } catch (err) {
        if (signal?.aborted) {
          throw err;
        }

        options.onProgress?.({
          type: "status_change",
          message: "Streaming unavailable, falling back to polling"
        });
        return await this.runWithPolling(jobId, options, Date.now(), timeoutMs, autoContinue);
      }
    }

    return await this.runWithPolling(jobId, options, Date.now(), timeoutMs, autoContinue);
  }

  private async runWithStream(
    jobId: string,
    options: JobRunnerOptions,
    startedAt: number,
    timeoutMs: number,
    autoContinue: boolean
  ): Promise<ChatResponse> {
    const streamClient = this.client.createStreamClient();
    const generator = streamClient.streamJobEvents(
      jobId,
      options.signal
        ? {
            sessionId: options.sessionId,
            signal: options.signal,
            onReconnect: (attempt, lastSeq) => {
              options.onProgress?.({
                type: "reconnecting",
                message: `Reconnecting to event stream (attempt ${attempt}, sequence ${lastSeq})...`
              });
            }
          }
        : {
            sessionId: options.sessionId,
            onReconnect: (attempt, lastSeq) => {
              options.onProgress?.({
                type: "reconnecting",
                message: `Reconnecting to event stream (attempt ${attempt}, sequence ${lastSeq})...`
              });
            }
          }
    );

    for await (const event of generator) {
      this.checkAborted(options.signal, jobId);

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out while waiting for SuperDocs edit to complete.");
      }

      const eventMessage = (event.data["message"] as string) || `Applying edit (${event.type})`;
      options.onProgress?.({
        type: "progress",
        message: eventMessage,
        detail: event.data
      });

      if (isSuccessfulStreamEvent(event)) {
        const result = parseStreamResult(event.data);
        if (result) {
          return result;
        }
        const fullJob = await this.client.getJob(jobId);
        if (isSuccessfulStatus(fullJob.status) && fullJob.result) return fullJob.result;
        throw new Error("SuperDocs job completed without a result payload.");
      }

      if (isFailedStreamEvent(event)) {
        const errorMsg = (event.data["error"] as string) || "SuperDocs edit job failed.";
        throw new Error(errorMsg);
      }

      if (event.type === "continue_prompt" || event.data["status"] === "awaiting_approval") {
        await this.handleContinuePrompt(jobId, options, autoContinue);
      }
    }

    const finalJob = await this.client.getJob(jobId);
    return this.resolveFinalJobStatus(finalJob);
  }

  private async runWithPolling(
    jobId: string,
    options: JobRunnerOptions,
    startedAt: number,
    timeoutMs: number,
    autoContinue: boolean
  ): Promise<ChatResponse> {
    const pollIntervalMs = options.pollIntervalMs ?? 2000;

    while (true) {
      this.checkAborted(options.signal, jobId);

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out while waiting for SuperDocs to finish the edit.");
      }

      const job = await this.client.getJob(jobId);

      options.onProgress?.({
        type: "status_change",
        message: `Applying edit (${job.status})`,
        ...(job.metadata ? { detail: job.metadata } : {})
      });

      if (isSuccessfulStatus(job.status)) {
        if (!job.result) {
          throw new Error("SuperDocs job completed without a result.");
        }
        return job.result;
      }

      if (job.status === "failed") {
        throw new Error(
          typeof job.error === "string" ? job.error : JSON.stringify(job.error ?? "Job failed")
        );
      }

      if (job.status === "cancelled") {
        throw new Error("SuperDocs job was cancelled.");
      }

      if (job.status === "awaiting_approval") {
        await this.handleContinuePrompt(jobId, options, autoContinue);
      }

      await sleep(pollIntervalMs);
    }
  }

  private async handleContinuePrompt(
    jobId: string,
    options: JobRunnerOptions,
    autoContinue: boolean
  ): Promise<void> {
    const promptMsg = "SuperDocs paused this large edit and needs confirmation to continue.";
    options.onContinuePrompt?.(promptMsg);

    const sessionId = options.sessionId;
    if (!sessionId) {
      throw new Error(promptMsg);
    }

    if (autoContinue) {
      options.onProgress?.({
        type: "status_change",
        message: "Auto-continuing paused edit..."
      });
      await this.client.continueChat(sessionId, jobId, true);
      return;
    }

    // No approver means the command is non-interactive. Stop the remote job
    // rather than leaving it running server-side after we abandon it.
    if (!options.onApprovalRequired) {
      await this.stopPausedJob(sessionId, jobId);
      throw new Error(promptMsg);
    }

    const approved = await options.onApprovalRequired(promptMsg);
    if (!approved) {
      await this.stopPausedJob(sessionId, jobId);
      throw new Error("Edit stopped: continuation was declined.");
    }

    options.onProgress?.({
      type: "status_change",
      message: "Continuing paused edit..."
    });
    await this.client.continueChat(sessionId, jobId, true);
  }

  private async stopPausedJob(sessionId: string, jobId: string): Promise<void> {
    await this.client.continueChat(sessionId, jobId, false).catch(() => {});
    await this.client.cancelJob(jobId).catch(() => {});
  }

  private resolveFinalJobStatus(job: JobResponse): ChatResponse {
    if (isSuccessfulStatus(job.status) && job.result) {
      return job.result;
    }
    if (job.status === "failed") {
      throw new Error(typeof job.error === "string" ? job.error : "SuperDocs job failed.");
    }
    if (job.status === "cancelled") {
      throw new Error("SuperDocs job was cancelled.");
    }
    throw new Error(`SuperDocs job finished with unexpected status: ${job.status}`);
  }

  private checkAborted(signal: AbortSignal | undefined, jobId: string): void {
    if (signal?.aborted) {
      void this.client.cancelJob(jobId).catch(() => {});
      throw new Error("Edit operation cancelled by user.");
    }
  }
}

function isSuccessfulStatus(status: JobResponse["status"]): boolean {
  return status === "completed" || status === "succeeded";
}

function isSuccessfulStreamEvent(event: { type: string; data: Record<string, unknown> }): boolean {
  const status = event.data["status"];
  return (
    event.type === "final" ||
    event.type === "complete" ||
    status === "completed" ||
    status === "succeeded"
  );
}

function isFailedStreamEvent(event: { type: string; data: Record<string, unknown> }): boolean {
  const status = event.data["status"];
  return (
    event.type === "error" ||
    event.type === "failed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function parseStreamResult(data: Record<string, unknown>): ChatResponse | undefined {
  const nestedResult = data["result"];
  const resultCandidate =
    typeof nestedResult === "object" && nestedResult !== null ? nestedResult : data;
  const result = ChatResponseSchema.safeParse(resultCandidate);

  if (!result.success) {
    return undefined;
  }

  const hasResponse = result.data.response !== undefined;
  const hasDocumentChanges = result.data.document_changes !== undefined;
  return hasResponse || hasDocumentChanges ? result.data : undefined;
}
