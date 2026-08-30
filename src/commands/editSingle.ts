import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { loadUserConfig } from "../config/userConfig.js";
import {
  ExportFormatSchema,
  ModelTierSchema,
  ResponseModeSchema,
  ThinkingDepthSchema
} from "../types/api.js";
import type { EditCommandOptions } from "../types/commands.js";
import { parseApproval, toApiApprovalMode } from "../utils/approval.js";
import { createClientForCommand } from "../utils/command.js";
import { generateUnifiedDiff } from "../utils/diff.js";
import {
  type EditableFile,
  acquireFileLock,
  createEditableFileFromBuffer,
  createSessionId,
  readEditableFile,
  readStdin,
  validateExportedTextBytes,
  writeFileAtomically
} from "../utils/files.js";
import { UsageError } from "../utils/errors.js";
import { isGitDiffContent } from "../utils/git.js";
import { processCleanup } from "../utils/cleanup.js";
import type { ILogger, Spinner } from "../utils/logger.js";
import { confirm } from "../utils/prompt.js";
import { DocumentUploader } from "../services/documentUploader.js";
import { JobRunner } from "../services/jobRunner.js";

export async function executeSingleEditCycle(
  file: string | undefined,
  options: EditCommandOptions,
  command: Command,
  prompt: string,
  logger: ILogger,
  spinner: Spinner,
  signal?: AbortSignal,
  gitContext?: string
): Promise<Uint8Array | undefined> {
  const isStdinMode = !file;
  const writeToStdout = isStdinMode && !options.output && !options.dryRun;
  const userConfig = await loadUserConfig();
  const modelTier = options.modelTier
    ? ModelTierSchema.parse(options.modelTier)
    : userConfig.default_model;
  const responseMode = options.responseMode
    ? ResponseModeSchema.parse(options.responseMode)
    : (userConfig.response_mode ?? "compact");
  const thinkingDepth = options.thinkingDepth
    ? ThinkingDepthSchema.parse(options.thinkingDepth)
    : undefined;

  const approve = parseApproval(options.approve);
  if (!approve) {
    throw new UsageError(
      `--approve must be one of: all, ask. Received '${String(options.approve)}'.`
    );
  }

  // Commander sets `autoContinue: false` for `--no-auto-continue`.
  // Asking for approval also means the user does not want silent continuation.
  const autoContinue = options.autoContinue !== false && approve === "all";

  let input: EditableFile;
  if (isStdinMode) {
    spinner.start("Reading from stdin");
    const stdinBytes = await readStdin();
    if (stdinBytes.byteLength === 0) {
      throw new Error("No input received from stdin.");
    }

    const stdinString = stdinBytes.toString("utf8");
    const isGitDiff = isGitDiffContent(stdinString);

    if (isGitDiff) {
      logger.debug("[git] Detected Git diff payload on stdin");
    }

    const defaultFormat = isGitDiff ? "txt" : "markdown";
    const format = options.format
      ? ExportFormatSchema.parse(options.format)
      : (userConfig.output_format ?? defaultFormat);

    input = createEditableFileFromBuffer(stdinBytes, format);
  } else {
    spinner.start("Reading file");
    input = await readEditableFile(file);
  }

  const outputPath = writeToStdout ? undefined : path.resolve(options.output ?? input.absolutePath);
  const sessionId =
    options.sessionId ?? createSessionId(isStdinMode ? "stdin" : input.absolutePath);
  const timeoutMs = parseTimeoutMs(options.timeoutSeconds, userConfig.timeout);
  const pollIntervalMs = parsePositiveSeconds(options.pollInterval, "--poll-interval") * 1000;

  let lock: Awaited<ReturnType<typeof acquireFileLock>> | undefined;
  let unregisterLockCleanup: (() => void) | undefined;

  try {
    lock = outputPath && !options.dryRun ? await acquireFileLock(outputPath) : undefined;
    if (lock) {
      unregisterLockCleanup = processCleanup.register(() => lock?.release());
    }

    const client = createClientForCommand(command, { timeoutMs });
    const uploader = new DocumentUploader(client);
    const jobRunner = new JobRunner(client);

    await uploader.upload(
      input,
      sessionId,
      (msg) => {
        spinner.text = msg;
      },
      signal
    );

    spinner.text = "Starting SuperDocs edit";
    const job = await client.chatAsync({
      message: buildMessage(prompt, gitContext),
      sessionId,
      approvalMode: toApiApprovalMode(approve),
      responseMode,
      ...(modelTier ? { modelTier } : {}),
      ...(thinkingDepth ? { thinkingDepth } : {})
    });

    logger.debug(`Queued SuperDocs job ${job.job_id} for session ${sessionId}`);

    await jobRunner.runToCompletion(job.job_id, {
      mode: "stream",
      sessionId,
      timeoutMs,
      pollIntervalMs,
      autoContinue,
      ...(signal ? { signal } : {}),
      onProgress: (event) => {
        logger.progress(spinner, event.message, event.detail);
      },
      onContinuePrompt: (message) => {
        spinner.text = message;
      },
      // Only offer a prompt when someone can actually answer it. In CI the
      // job is stopped and the pause is reported instead.
      ...(process.stdin.isTTY
        ? {
            onApprovalRequired: async (message: string) => {
              spinner.stop();
              const approved = await confirm(`${message} Continue?`);
              if (approved) {
                spinner.start("Continuing edit");
              }
              return approved;
            }
          }
        : {})
    });

    spinner.text = `Exporting ${input.exportFormat}`;
    const exported = await client.exportDocument({
      sessionId,
      format: input.exportFormat,
      filename: input.filename
    });
    validateExportedTextBytes(exported, input.bytes);

    // Handle Dry Run Mode
    if (options.dryRun) {
      spinner.stop();
      const originalText = input.bytes.toString("utf8");
      const editedText = new TextDecoder().decode(exported);
      // The diff is the stdout payload, so its colouring must follow the
      // destination stream, not chalk's ambient detection. chalk honours
      // FORCE_COLOR over NO_COLOR, and npm exports FORCE_COLOR to lifecycle
      // scripts running under a terminal, which leaked escape codes into
      // redirected output. Anything piped or written to a file stays plain.
      const diff = generateUnifiedDiff(originalText, editedText, {
        filename: input.filename,
        color: process.stdout.isTTY === true
      });

      if (logger.json) {
        logger.writeJson({
          ok: true,
          dryRun: true,
          ...(isStdinMode ? {} : { file: input.absolutePath }),
          sessionId,
          jobId: job.job_id,
          format: input.exportFormat,
          proposed: editedText,
          diff
        });
        return exported;
      }

      if (!diff) {
        logger.info(chalk.yellow("No changes proposed by SuperDocs."));
      } else {
        // The diff is the payload, so it goes to stdout and stays redirectable.
        logger.info(chalk.bold("--- Proposed Changes (Dry Run) ---"));
        logger.output(diff.endsWith("\n") ? diff : `${diff}\n`);
        logger.info(chalk.gray("(Dry run active: no files were modified)"));
      }
      return exported;
    }

    if (writeToStdout) {
      spinner.stop();
      if (!logger.json) {
        logger.output(exported);
      }
    } else {
      await writeFileAtomically(outputPath!, exported);
      spinner.succeed(`Edited file saved to ${outputPath}`);
    }

    if (logger.json) {
      logger.writeJson({
        ok: true,
        ...(isStdinMode ? {} : { file: input.absolutePath }),
        output: outputPath ?? "stdout",
        sessionId,
        jobId: job.job_id,
        format: input.exportFormat
      });
    } else if (!writeToStdout && !options.watch) {
      logger.info(chalk.gray(`Session: ${sessionId}`));
      logger.info(chalk.gray(`Job: ${job.job_id}`));
    }

    return exported;
  } finally {
    unregisterLockCleanup?.();
    await lock?.release();
  }
}

/**
 * Appends repository state to the instruction when `--git` is used, so the flag
 * actually influences the edit instead of only printing to the terminal.
 */
function buildMessage(prompt: string, gitContext: string | undefined): string {
  return gitContext ? `${prompt}\n\n${gitContext}` : prompt;
}

function parseTimeoutMs(value?: string, defaultSeconds = 1800): number {
  return parsePositiveSeconds(value ?? String(defaultSeconds), "--timeout-seconds") * 1000;
}

function parsePositiveSeconds(value: string | undefined, option: string): number {
  const seconds = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new UsageError(`${option} must be a positive number.`);
  }

  return seconds;
}
