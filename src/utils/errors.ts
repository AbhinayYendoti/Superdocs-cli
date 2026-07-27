import chalk from "chalk";
import { CommanderError } from "commander";
import { ZodError } from "zod";
import { ExitCode } from "./exitCodes.js";
import { redactSecrets } from "./redact.js";

export class MissingApiKeyError extends Error {
  constructor() {
    super("No SuperDocs credentials found.\n\nRun:\nsuperdocs auth login");
    this.name = "MissingApiKeyError";
  }
}

export class SuperDocsError extends Error {
  readonly status: number;
  readonly retryAfter: number | undefined;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      retryAfter?: number | undefined;
      requestId?: string | undefined;
      details?: unknown;
    }
  ) {
    super(redactSecrets(message));
    this.name = "SuperDocsError";
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export function formatFriendlyError(error: unknown): string {
  if (error instanceof MissingApiKeyError) {
    return error.message;
  }

  if (error instanceof SuperDocsError) {
    const trace = error.requestId ? ` [Request ID: ${error.requestId}]` : "";

    if (error.status === 401) {
      return `SuperDocs could not verify your credentials.${trace}`;
    }

    if (error.status === 403) {
      return `Your SuperDocs account does not have access to this resource.${trace}`;
    }

    if (error.status === 404) {
      return `SuperDocs could not find the requested session, job, document, or upload.${trace}`;
    }

    if (error.status === 413) {
      return `Document is too large for this request path. Try a smaller file or request a limit increase.${trace}`;
    }

    if (error.status === 415) {
      return `Unsupported file type. SuperDocs edit supports .md, .markdown, and .txt files.${trace}`;
    }

    if (error.status === 429) {
      const wait = error.retryAfter ? ` Retry after ${error.retryAfter} seconds.` : "";
      return `SuperDocs rate or quota limit was reached.${wait}${trace}`;
    }

    if (error.status >= 500) {
      return `SuperDocs server error (${error.status}). Please try again in a moment.${trace}`;
    }

    return `SuperDocs API error (${error.status}): ${error.message}${trace}`;
  }

  if (error instanceof ZodError) {
    const issueMsg = error.issues[0]?.message ?? "validation failed";
    if (issueMsg.includes("API key")) {
      return "That does not look like a valid SuperDocs API key.";
    }
    if (issueMsg.includes("expected object") && issueMsg.includes("received null")) {
      return "SuperDocs returned an empty or unexpected response.";
    }
    return `Validation error: ${issueMsg}`;
  }

  if (error instanceof Error) {
    const msg = error.message;

    if (isNetworkError(error)) {
      return "Could not connect to SuperDocs.";
    }

    if (msg.includes("No input received from stdin")) {
      return "No input received from stdin.";
    }

    if (msg.includes("is empty")) {
      return msg;
    }

    if (msg.includes("not valid UTF-8") || msg.includes("appears to be binary data")) {
      return msg;
    }

    if (msg.includes("already using")) {
      return msg;
    }

    if (msg.includes("SuperDocs returned an empty export")) {
      return msg;
    }

    if (error.name === "AbortError" || msg.includes("operation was aborted")) {
      return "Edit operation cancelled by user.";
    }

    if (msg.includes("--prompt is required")) {
      return msg;
    }

    if (isFSEnoentError(error)) {
      const filePath = extractPathFromEnoent(msg);
      return `Could not find input file${filePath ? ` '${filePath}'` : ""}.`;
    }

    return redactSecrets(msg);
  }

  return "An unexpected error occurred.";
}

export function formatFriendlyHint(error: unknown): string | undefined {
  if (error instanceof MissingApiKeyError) {
    return undefined;
  }

  if (error instanceof SuperDocsError) {
    if (error.status === 401) {
      return "Run `superdocs auth login` to sign in again.";
    }

    if (error.status === 413) {
      return "Try a smaller file or split the document into smaller sections.";
    }

    if (error.status === 429) {
      return "Wait for Retry-After duration, upgrade your plan, or retry later.";
    }
  }

  if (error instanceof ZodError) {
    const issueMsg = error.issues[0]?.message ?? "";
    if (issueMsg.includes("API key")) {
      return "Copy your API key from SuperDocs, then run `superdocs auth login` again.";
    }
    if (issueMsg.includes("expected object") && issueMsg.includes("received null")) {
      return "Try again in a moment. If this repeats, run with --verbose and contact SuperDocs support.";
    }
  }

  if (error instanceof Error) {
    if (isNetworkError(error)) {
      return "Check your internet connection, then try again.";
    }

    if (error.message.includes("No input received from stdin")) {
      return 'Pipe content into the command, or pass a file path: `superdocs edit file.md --prompt "Fix typos"`.';
    }

    if (error.message.includes("is empty")) {
      return "Add text to the file, or pass content on stdin.";
    }

    if (
      error.message.includes("not valid UTF-8") ||
      error.message.includes("appears to be binary data")
    ) {
      return "Use a UTF-8 .md, .markdown, or .txt file. Convert binary or legacy-encoded files before editing.";
    }

    if (error.message.includes("already using")) {
      return "Run one edit per output file at a time.";
    }

    if (error.message.includes("SuperDocs returned an empty export")) {
      return "Try again with --dry-run or --output to inspect the result without replacing the original file.";
    }

    if (error.message.includes("--prompt is required")) {
      return "Pass --prompt, or run the command in an interactive terminal so SuperDocs can ask for one.";
    }

    if (isFSEnoentError(error)) {
      return "Check the file path and verify that the file exists.";
    }
  }

  return undefined;
}

export function getExitCode(error: unknown): ExitCode {
  if (error instanceof CommanderError) {
    return error.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage;
  }

  if (error instanceof MissingApiKeyError) {
    return ExitCode.Config;
  }

  if (error instanceof SuperDocsError) {
    if (error.status === 401 || error.status === 403) {
      return ExitCode.Auth;
    }

    if (error.status >= 500 || error.status === 408 || error.status === 429) {
      return ExitCode.Network;
    }

    return ExitCode.Api;
  }

  if (error instanceof Error) {
    if (isNetworkError(error)) {
      return ExitCode.Network;
    }

    if (/timed out|timeout/iu.test(error.message)) {
      return ExitCode.Timeout;
    }

    if (error.name === "TimeoutError") {
      return ExitCode.Timeout;
    }
  }

  return ExitCode.Error;
}

export function printError(error: unknown): void {
  console.error(chalk.red("Error:"), formatFriendlyError(error));
  const hint = formatFriendlyHint(error);
  if (hint) {
    console.error(chalk.bold("Fix:"), hint);
  }
}

function isNetworkError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout")
  );
}

function isFSEnoentError(error: Error): boolean {
  return error.message.includes("ENOENT: no such file or directory");
}

function extractPathFromEnoent(msg: string): string | undefined {
  const match = /open '([^']+)'/u.exec(msg);
  return match ? match[1] : undefined;
}
