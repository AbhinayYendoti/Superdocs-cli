import { z } from "zod";

export const ApiKeySchema = z
  .string()
  .trim()
  .min(10, "API key is too short")
  .regex(/^(sk|lce)_[A-Za-z0-9_.-]+$/, "API key must start with sk_ or lce_");

export const UsageSchema = z
  .object({
    monthly_used: z.number().optional(),
    monthly_limit: z.number().optional(),
    monthly_remaining: z.number().optional(),
    was_billable: z.boolean().optional(),
    subscription_tier: z.string().optional()
  })
  .passthrough();

export type Usage = z.infer<typeof UsageSchema>;

export const SessionSummarySchema = z
  .object({
    session_id: z.string().optional(),
    id: z.string().optional(),
    message_count: z.number().optional(),
    updated_at: z.string().optional(),
    created_at: z.string().optional(),
    preview: z.string().optional()
  })
  .passthrough();

export const ListSessionsResponseSchema = z
  .union([
    z.array(SessionSummarySchema),
    z.object({ sessions: z.array(SessionSummarySchema) }).passthrough()
  ])
  .transform((value) => (Array.isArray(value) ? value : value.sessions));

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const UploadDocumentResponseSchema = z
  .object({
    session_id: z.string().optional(),
    filename: z.string().optional(),
    chunks_count: z.number().optional(),
    version_id: z.string().optional(),
    html: z.string().nullable().optional()
  })
  .passthrough();

export type UploadDocumentResponse = z.infer<typeof UploadDocumentResponseSchema>;

export const RequestUploadUrlResponseSchema = z
  .object({
    upload_id: z.string(),
    upload_url: z.string().url().optional(),
    signed_url: z.string().url().optional(),
    url: z.string().url().optional(),
    curl_example: z.string().optional()
  })
  .passthrough()
  .transform((value) => {
    const uploadUrl = value.upload_url ?? value.signed_url ?? value.url;
    if (!uploadUrl) {
      throw new Error("SuperDocs response did not include an upload URL.");
    }

    return {
      ...value,
      upload_url: uploadUrl
    };
  });

export type RequestUploadUrlResponse = z.infer<typeof RequestUploadUrlResponseSchema>;

export const ProcessUploadedDocumentResponseSchema = z
  .object({
    upload_id: z.string().optional(),
    session_id: z.string().optional(),
    filename: z.string().optional(),
    chunks_count: z.number().optional(),
    version_id: z.string().optional(),
    html: z.string().nullable().optional()
  })
  .passthrough();

export type ProcessUploadedDocumentResponse = z.infer<typeof ProcessUploadedDocumentResponseSchema>;

const DocumentChangeItemSchema = z.record(z.string(), z.unknown());

export const DocumentChangesSchema = z
  .object({
    updated_html: z.string().nullable().optional(),
    version_id: z.string().optional(),
    changes_summary: z.string().optional(),
    requires_approval: z.boolean().nullable().optional(),
    pending_changes: z.array(DocumentChangeItemSchema).nullable().optional(),
    concurrent_merges: z.array(DocumentChangeItemSchema).nullable().optional()
  })
  .passthrough();

export type DocumentChanges = z.infer<typeof DocumentChangesSchema>;

export const ChatResponseSchema = z
  .object({
    response: z.string().optional(),
    session_id: z.string().optional(),
    document_changes: DocumentChangesSchema.optional(),
    usage: UsageSchema.optional()
  })
  .passthrough();

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ChatAsyncResponseSchema = z
  .object({
    job_id: z.string(),
    session_id: z.string(),
    status: z.string(),
    message: z.string().optional(),
    usage: UsageSchema.optional()
  })
  .passthrough();

export type ChatAsyncResponse = z.infer<typeof ChatAsyncResponseSchema>;

export const JobStatusSchema = z.enum([
  "pending",
  "in_progress",
  "processing",
  "awaiting_approval",
  "completed",
  "succeeded",
  "failed",
  "cancelled"
]);

export type JobStatus = z.infer<typeof JobStatusSchema>;

const JobErrorSchema = z.union([z.string(), z.record(z.string(), z.unknown())]);

const JobBaseSchema = z
  .object({
    job_id: z.string().optional(),
    id: z.string().optional(),
    job_type: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

const JobNonTerminalResponseSchema = JobBaseSchema.extend({
  status: z.enum(["pending", "in_progress", "processing", "awaiting_approval", "cancelled"]),
  result: ChatResponseSchema.nullable().optional(),
  error: JobErrorSchema.nullable().optional()
});

const JobCompletedResponseSchema = JobBaseSchema.extend({
  status: z.enum(["completed", "succeeded"]),
  result: ChatResponseSchema,
  error: JobErrorSchema.nullable().optional()
});

const JobFailedResponseSchema = JobBaseSchema.extend({
  status: z.literal("failed"),
  result: ChatResponseSchema.nullable().optional(),
  error: JobErrorSchema.nullable().optional()
});

export const JobResponseSchema = z.discriminatedUnion("status", [
  JobNonTerminalResponseSchema,
  JobCompletedResponseSchema,
  JobFailedResponseSchema
]);

export type JobResponse = z.infer<typeof JobResponseSchema>;

export const ContinueChatResponseSchema = JobResponseSchema.or(
  z.object({ status: z.string() }).passthrough()
);

export type ContinueChatResponse = z.infer<typeof ContinueChatResponseSchema>;

export const HealthResponseSchema = z.object({ status: z.string() }).passthrough();

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ModelTierSchema = z.enum(["core", "turbo", "pro", "max"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const ThinkingDepthSchema = z.enum(["fast", "balanced", "deep"]);
export type ThinkingDepth = z.infer<typeof ThinkingDepthSchema>;

export const ResponseModeSchema = z.enum(["compact", "full"]);
export type ResponseMode = z.infer<typeof ResponseModeSchema>;

export const ExportFormatSchema = z.enum(["markdown", "txt"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
