import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ChatAsyncResponseSchema,
  ChatResponseSchema,
  ContinueChatResponseSchema,
  HealthResponseSchema,
  JobResponseSchema,
  ListSessionsResponseSchema,
  ProcessUploadedDocumentResponseSchema,
  RequestUploadUrlResponseSchema,
  UploadDocumentResponseSchema,
  type ChatAsyncResponse,
  type ChatResponse,
  type ContinueChatResponse,
  type ExportFormat,
  type HealthResponse,
  type JobResponse,
  type ModelTier,
  type ResponseMode,
  type ProcessUploadedDocumentResponse,
  type RequestUploadUrlResponse,
  type SessionSummary,
  type ThinkingDepth,
  type UploadDocumentResponse
} from "../types/api.js";
import { StreamClient } from "./streamClient.js";
import { SuperDocsError } from "../utils/errors.js";
import { redactSecrets } from "../utils/redact.js";
import { sleep } from "../utils/sleep.js";

const DEFAULT_BASE_URL = "https://api.superdocs.app";
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_RETRIES = 2;

export interface SuperDocsClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  debug?: (message: string) => void;
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  documentHtml?: string;
  modelTier?: ModelTier;
  thinkingDepth?: ThinkingDepth;
  approvalMode?: "approve_all" | "ask_every_time";
  responseMode?: ResponseMode;
}

export interface UploadDocumentBase64Request {
  filename: string;
  file: Buffer;
  sessionId: string;
  returnHtml?: boolean;
}

export interface RequestUploadUrlRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
  purpose: "document" | "attachment";
}

export interface ProcessUploadedDocumentRequest {
  uploadId: string;
  filename: string;
  sessionId: string;
  parseMode: "document" | "attachment";
  returnHtml?: boolean;
}

export interface ExportDocumentRequest {
  sessionId: string;
  format: ExportFormat;
  filename?: string;
}

export interface WaitForJobOptions {
  sessionId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  autoContinue?: boolean;
  onStatus?: (job: JobResponse) => void;
  onContinuePrompt?: (message: string) => void;
}

import type { ISuperDocsClient } from "./interfaces.js";

export class SuperDocsClient implements ISuperDocsClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly debug: ((message: string) => void) | undefined;

  constructor(options: SuperDocsClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_RETRIES;
    this.debug = options.debug;
  }

  createStreamClient(): StreamClient {
    return new StreamClient({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      ...(this.debug ? { debug: this.debug } : {})
    });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  async health(): Promise<HealthResponse> {
    return this.requestJson(
      "/health",
      { method: "GET", auth: false },
      HealthResponseSchema,
      "HealthResponseSchema"
    );
  }

  async listSessions(limit = 10): Promise<SessionSummary[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    return this.requestJson(
      `/v1/sessions?${params.toString()}`,
      { method: "GET" },
      ListSessionsResponseSchema,
      "ListSessionsResponseSchema"
    );
  }

  async verifyAuthentication(): Promise<void> {
    await this.listSessions(1);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.requestJson(
      "/v1/chat",
      {
        method: "POST",
        json: this.toChatBody(request)
      },
      ChatResponseSchema,
      "ChatResponseSchema"
    );
  }

  async chatAsync(request: ChatRequest): Promise<ChatAsyncResponse> {
    return this.requestJson(
      "/v1/chat/async",
      {
        method: "POST",
        json: this.toChatBody(request)
      },
      ChatAsyncResponseSchema,
      "ChatAsyncResponseSchema"
    );
  }

  async uploadDocumentBase64(
    request: UploadDocumentBase64Request
  ): Promise<UploadDocumentResponse> {
    return this.requestJson(
      "/v1/documents/upload-base64",
      {
        method: "POST",
        json: {
          filename: request.filename,
          file_base64: request.file.toString("base64"),
          session_id: request.sessionId,
          return_html: request.returnHtml ?? false
        }
      },
      UploadDocumentResponseSchema,
      "UploadDocumentResponseSchema"
    );
  }

  async requestUploadUrl(request: RequestUploadUrlRequest): Promise<RequestUploadUrlResponse> {
    return this.requestJson(
      "/v1/uploads",
      {
        method: "POST",
        json: {
          filename: request.filename,
          content_type: request.contentType,
          size_bytes: request.sizeBytes,
          purpose: request.purpose
        }
      },
      RequestUploadUrlResponseSchema,
      "RequestUploadUrlResponseSchema"
    );
  }

  async uploadToSignedUrl(
    uploadUrl: string,
    bytes: Buffer,
    contentType: string,
    signal?: AbortSignal
  ): Promise<void> {
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);

    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const method = "PUT";
    this.logHttpRequest(method, uploadUrl);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength)
      },
      body,
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    });
    this.logHttpResponse(method, uploadUrl, response);

    if (!response.ok) {
      throw await this.toError(response);
    }
  }

  async processUploadedDocument(
    request: ProcessUploadedDocumentRequest
  ): Promise<ProcessUploadedDocumentResponse> {
    return this.requestJson(
      `/v1/uploads/${encodeURIComponent(request.uploadId)}/process`,
      {
        method: "POST",
        json: {
          filename: request.filename,
          session_id: request.sessionId,
          parse_mode: request.parseMode,
          return_html: request.returnHtml ?? false
        }
      },
      ProcessUploadedDocumentResponseSchema,
      "ProcessUploadedDocumentResponseSchema"
    );
  }

  async getJob(jobId: string): Promise<JobResponse> {
    return this.requestJson(
      `/v1/jobs/${encodeURIComponent(jobId)}`,
      { method: "GET" },
      JobResponseSchema,
      "JobResponseSchema"
    );
  }

  async cancelJob(jobId: string): Promise<JobResponse> {
    return this.requestJson(
      `/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" },
      JobResponseSchema,
      "JobResponseSchema"
    );
  }

  async continueChat(
    sessionId: string,
    jobId: string,
    shouldContinue: boolean
  ): Promise<ContinueChatResponse> {
    return this.requestJson(
      `/v1/chat/${encodeURIComponent(sessionId)}/continue`,
      {
        method: "POST",
        json: {
          job_id: jobId,
          continue: shouldContinue
        }
      },
      ContinueChatResponseSchema,
      "ContinueChatResponseSchema"
    );
  }

  async waitForJob(jobId: string, options: WaitForJobOptions = {}): Promise<ChatResponse> {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;

    while (true) {
      const job = await this.getJob(jobId);
      options.onStatus?.(job);

      if (isSuccessfulJobStatus(job.status)) {
        if (!job.result) {
          throw new Error("SuperDocs job completed without a result.");
        }

        return job.result;
      }

      if (job.status === "failed") {
        throw new Error(describeJobError(job.error));
      }

      if (job.status === "cancelled") {
        throw new Error("SuperDocs job was cancelled.");
      }

      if (job.status === "awaiting_approval") {
        await this.handleAwaitingApproval(jobId, job, options);
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out while waiting for SuperDocs to finish the edit.");
      }

      await sleep(pollIntervalMs);
    }
  }

  async exportDocument(request: ExportDocumentRequest): Promise<Uint8Array> {
    return this.requestBytes("/v1/documents/export", {
      method: "POST",
      json: {
        session_id: request.sessionId,
        format: request.format,
        filename: request.filename
      }
    });
  }

  private async handleAwaitingApproval(
    jobId: string,
    job: JobResponse,
    options: WaitForJobOptions
  ): Promise<void> {
    const metadata = job.metadata ?? {};
    const awaitingKind = metadata["awaiting_kind"];

    if (awaitingKind === "continue_prompt") {
      const prompt = parseContinuePrompt(metadata["continue_prompt"]);
      options.onContinuePrompt?.(prompt);

      if (options.autoContinue && options.sessionId) {
        await this.continueChat(options.sessionId, jobId, true);
        return;
      }

      throw new Error(prompt);
    }

    throw new Error(
      "SuperDocs is waiting for human approval, but `superdocs edit` currently runs in auto-apply mode."
    );
  }

  private toChatBody(request: ChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      message: request.message,
      session_id: request.sessionId,
      approval_mode: request.approvalMode ?? "approve_all"
    };

    if (request.documentHtml !== undefined) body["document_html"] = request.documentHtml;
    if (request.modelTier !== undefined) body["model_tier"] = request.modelTier;
    if (request.thinkingDepth !== undefined) body["thinking_depth"] = request.thinkingDepth;
    if (request.responseMode !== undefined) body["response_mode"] = request.responseMode;

    return body;
  }

  private async requestJson<Schema extends z.ZodType>(
    path: string,
    options: RequestOptions,
    schema: Schema,
    schemaName: string
  ): Promise<z.infer<Schema>> {
    const response = await this.fetchWithRetry(path, options);
    const rawBody = await response.text();
    this.logJsonBody(schemaName, rawBody);

    let json: unknown;
    try {
      json = rawBody ? JSON.parse(rawBody) : null;
    } catch (error) {
      this.debugLog(`[http] ${schemaName} JSON parse failed`);
      this.debugLog(`[http] raw response body:\n${rawBody}`);
      throw error;
    }

    try {
      return schema.parse(json);
    } catch (error) {
      if (error instanceof z.ZodError) {
        this.debugLog(`[http] validation failed for ${schemaName}`);
        this.debugLog(`[http] raw response body:\n${rawBody}`);
        this.debugLog(`[http] Zod validation errors:\n${JSON.stringify(error.issues, null, 2)}`);
      }
      throw error;
    }
  }

  private async requestBytes(path: string, options: RequestOptions): Promise<Uint8Array> {
    const response = await this.fetchWithRetry(path, options);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async fetchWithRetry(path: string, options: RequestOptions): Promise<Response> {
    let lastError: unknown;
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const init: RequestInit = {
          method: options.method,
          headers: this.headers(options),
          signal: AbortSignal.timeout(timeoutMs)
        };

        if (options.json) {
          init.body = JSON.stringify(options.json);
        }

        const url = this.url(path);
        this.logHttpRequest(options.method, url);
        const response = await fetch(url, init);
        this.logHttpResponse(options.method, url, response);

        if (response.ok) {
          return response;
        }

        if (attempt < this.maxRetries && this.isRetryable(response)) {
          const delayMs = this.retryDelayMs(attempt, response);
          if (Date.now() - startedAt + delayMs >= timeoutMs) {
            throw await this.toError(response);
          }
          await sleep(delayMs);
          continue;
        }

        throw await this.toError(response);
      } catch (error) {
        lastError = error;

        if (
          error instanceof SuperDocsError ||
          isAbortOrTimeoutError(error) ||
          attempt >= this.maxRetries
        ) {
          throw error;
        }

        const delayMs = this.retryDelayMs(attempt);
        if (Date.now() - startedAt + delayMs >= timeoutMs) {
          throw error;
        }
        await sleep(delayMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("SuperDocs request failed.");
  }

  private headers(options: RequestOptions): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.headers ?? {})
    };

    if (options.json) {
      headers["Content-Type"] = "application/json";
    }

    if (options.method === "POST" || options.method === "PUT") {
      headers["Idempotency-Key"] = options.headers?.["Idempotency-Key"] ?? `req_${randomUUID()}`;
    }

    if (options.auth !== false) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private url(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      return path;
    }

    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private isRetryable(response: Response): boolean {
    return response.status === 429 || response.status === 408 || response.status >= 500;
  }

  private retryDelayMs(attempt: number, response?: Response): number {
    if (response) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSec = parseRetryAfter(retryAfterHeader);
      if (retryAfterSec !== undefined) {
        return retryAfterSec * 1000;
      }
    }
    const base = 500 * 2 ** attempt;
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  private async toError(response: Response): Promise<SuperDocsError> {
    const text = await response.text();
    this.debugLog(`[http] raw error response body:\n${text}`);
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    const requestId =
      response.headers.get("x-request-id") ??
      response.headers.get("superdocs-request-id") ??
      undefined;
    const parsed = tryParseJson(text);
    const message = (extractErrorMessage(parsed) ?? text) || response.statusText;
    const options: {
      status: number;
      retryAfter?: number;
      requestId?: string;
      details?: unknown;
    } = {
      status: response.status,
      details: parsed ?? text
    };

    if (retryAfter !== undefined) {
      options.retryAfter = retryAfter;
    }
    if (requestId !== undefined) {
      options.requestId = requestId;
    }

    return new SuperDocsError(redactSecrets(message), options);
  }

  private logHttpRequest(method: string, url: string): void {
    this.debugLog(`[http] request ${method} ${url}`);
  }

  private logHttpResponse(method: string, url: string, response: Response): void {
    this.debugLog(`[http] response ${method} ${url} -> ${response.status} ${response.statusText}`);
    this.debugLog(
      `[http] response headers:\n${JSON.stringify(headersToObject(response.headers), null, 2)}`
    );
  }

  private logJsonBody(schemaName: string, rawBody: string): void {
    this.debugLog(`[http] raw JSON response body before ${schemaName} validation:\n${rawBody}`);
  }

  private debugLog(message: string): void {
    this.debug?.(redactSecrets(message));
  }
}

interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  auth?: boolean;
  headers?: Record<string, string>;
  json?: Record<string, unknown>;
  timeoutMs?: number;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function tryParseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "detail" in value) {
    const detail = value.detail;
    if (typeof detail === "string") {
      return detail;
    }

    return JSON.stringify(detail);
  }

  return undefined;
}

function describeJobError(error: JobResponse["error"]): string {
  if (!error) {
    return "SuperDocs job failed.";
  }

  return typeof error === "string" ? error : JSON.stringify(error);
}

function isSuccessfulJobStatus(status: JobResponse["status"]): boolean {
  return status === "completed" || status === "succeeded";
}

function parseContinuePrompt(value: unknown): string {
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }

  return "SuperDocs paused this large edit and needs confirmation to continue.";
}

function isAbortOrTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.name === "TimeoutError";
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
