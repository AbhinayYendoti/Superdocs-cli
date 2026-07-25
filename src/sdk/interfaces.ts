import type {
  ChatAsyncResponse,
  ChatResponse,
  ContinueChatResponse,
  HealthResponse,
  JobResponse,
  ProcessUploadedDocumentResponse,
  RequestUploadUrlResponse,
  SessionSummary,
  UploadDocumentResponse
} from "../types/api.js";
import type {
  ChatRequest,
  ExportDocumentRequest,
  ProcessUploadedDocumentRequest,
  RequestUploadUrlRequest,
  UploadDocumentBase64Request
} from "./SuperDocsClient.js";
import type { JobEvent, StreamJobEventsOptions } from "./streamClient.js";

export interface IStreamClient {
  streamJobEvents(
    jobId: string,
    options?: Omit<StreamJobEventsOptions, "baseUrl" | "apiKey" | "jobId">
  ): AsyncGenerator<JobEvent, void, unknown>;
}

export interface ISuperDocsClient {
  health(): Promise<HealthResponse>;
  listSessions(limit?: number): Promise<SessionSummary[]>;
  verifyAuthentication(): Promise<void>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatAsync(request: ChatRequest): Promise<ChatAsyncResponse>;
  uploadDocumentBase64(request: UploadDocumentBase64Request): Promise<UploadDocumentResponse>;
  requestUploadUrl(request: RequestUploadUrlRequest): Promise<RequestUploadUrlResponse>;
  uploadToSignedUrl(
    uploadUrl: string,
    bytes: Buffer,
    contentType: string,
    signal?: AbortSignal
  ): Promise<void>;
  processUploadedDocument(
    request: ProcessUploadedDocumentRequest
  ): Promise<ProcessUploadedDocumentResponse>;
  getJob(jobId: string): Promise<JobResponse>;
  cancelJob(jobId: string): Promise<JobResponse>;
  continueChat(
    sessionId: string,
    jobId: string,
    shouldContinue: boolean
  ): Promise<ContinueChatResponse>;
  exportDocument(request: ExportDocumentRequest): Promise<Uint8Array>;
  createStreamClient(): IStreamClient;
  getBaseUrl(): string;
  getApiKey(): string;
}
