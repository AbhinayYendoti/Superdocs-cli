import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import type { EditCommandOptions } from "../types/commands.js";
import { formatFriendlyError, formatFriendlyHint } from "../utils/errors.js";
import { readEditableFile } from "../utils/files.js";
import type { ILogger } from "../utils/logger.js";
import { computeBufferHash, watchFile } from "../utils/watcher.js";
import { executeSingleEditCycle } from "./editSingle.js";

export async function runWatchMode(
  filePath: string,
  options: EditCommandOptions,
  command: Command,
  prompt: string,
  logger: ILogger,
  signal?: AbortSignal,
  gitContext?: string
): Promise<void> {
  const debounceMs = parsePositiveMs(options.watchDebounce ?? "300", "--watch-debounce");
  const absoluteInputPath = path.resolve(filePath);
  const outputPath = path.resolve(options.output ?? absoluteInputPath);
  let lastProcessedHash: string | null = null;
  let isEditing = false;
  let pendingChange = false;
  let ready = false;

  const recordProcessed = async (exportedBytes: Uint8Array | undefined): Promise<void> => {
    if (exportedBytes) {
      lastProcessedHash = computeBufferHash(exportedBytes);
      return;
    }
    const writtenBytes = await fs.readFile(outputPath);
    lastProcessedHash = computeBufferHash(writtenBytes);
  };

  const processChange = async (): Promise<void> => {
    // Queue anything that arrives before the first pass finishes or while an
    // edit is in flight; the `finally` block drains it.
    if (!ready || isEditing || signal?.aborted) {
      pendingChange = true;
      return;
    }

    try {
      const currentFile = await readEditableFile(filePath);
      const currentHash = computeBufferHash(currentFile.bytes);

      if (currentHash === lastProcessedHash) {
        return;
      }

      isEditing = true;
      pendingChange = false;
      logger.info(chalk.yellow(`[watch] Change detected in ${filePath}. Sending to SuperDocs...`));

      const spinner = logger.spinner("Processing change");
      const exportedBytes = await executeSingleEditCycle(
        filePath,
        options,
        command,
        prompt,
        logger,
        spinner,
        signal,
        gitContext
      );

      await recordProcessed(exportedBytes);
      logger.info(chalk.green(`[watch] Edit complete. Updated ${outputPath}`));
    } catch (error) {
      logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    } finally {
      isEditing = false;
      if (pendingChange && !signal?.aborted) {
        pendingChange = false;
        void processChange();
      }
    }
  };

  // The watcher is registered before the first edit runs. Registering it
  // afterwards left a window in which edits made during that first pass were
  // lost until the next unrelated save.
  const watcher = watchFile({
    filePath,
    debounceMs,
    onChange: () => processChange(),
    onError: (err) => {
      logger.error(`[watch] Watcher error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  logger.info(chalk.blue(`[watch] Starting initial edit for ${filePath}...`));

  const initialSpinner = logger.spinner("Preparing edit");
  try {
    const exportedBytes = await executeSingleEditCycle(
      filePath,
      options,
      command,
      prompt,
      logger,
      initialSpinner,
      signal,
      gitContext
    );
    await recordProcessed(exportedBytes);
  } catch (error) {
    if (initialSpinner.isSpinning) {
      initialSpinner.fail("Initial edit failed");
    }
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
  }

  logger.info(
    chalk.blue(
      `[watch] Watching ${filePath} for changes (debounce: ${debounceMs}ms)... (Press Ctrl+C to exit)`
    )
  );

  ready = true;
  // Drain anything that landed during the initial pass. The hash check makes
  // this a no-op when the only writer was the initial edit itself.
  if (!signal?.aborted) {
    pendingChange = false;
    void processChange();
  }

  // Interrupt handling belongs to the caller (`edit.ts`), which owns the single
  // AbortController for the command. Registering SIGINT/SIGTERM here as well
  // leaked one listener pair per run and raced with the in-flight edit's lock.
  return new Promise<void>((resolve) => {
    let closed = false;
    const cleanup = () => {
      if (closed) {
        return;
      }
      closed = true;
      logger.info(chalk.gray("[watch] Stopping file watcher..."));
      watcher.close();
      resolve();
    };

    if (!signal) {
      cleanup();
      return;
    }

    if (signal.aborted) {
      cleanup();
      return;
    }

    signal.addEventListener("abort", cleanup, { once: true });
  });
}

function parsePositiveMs(value: string | undefined, option: string): number {
  const ms = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`${option} must be a non-negative number of milliseconds.`);
  }

  return ms;
}
