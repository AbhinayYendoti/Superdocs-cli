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
  signal?: AbortSignal
): Promise<void> {
  const debounceMs = parsePositiveMs(options.watchDebounce ?? "300", "--watch-debounce");
  const absoluteInputPath = path.resolve(filePath);
  const outputPath = path.resolve(options.output ?? absoluteInputPath);
  let lastProcessedHash: string | null = null;
  let isEditing = false;
  let pendingChange = false;

  logger.info(chalk.blue(`[watch] Starting initial edit for ${filePath}...`));

  // Initial edit pass
  const initialSpinner = logger.spinner("Preparing edit");
  try {
    const exportedBytes = await executeSingleEditCycle(
      filePath,
      options,
      command,
      prompt,
      logger,
      initialSpinner,
      signal
    );
    if (exportedBytes) {
      lastProcessedHash = computeBufferHash(exportedBytes);
    } else {
      const writtenBytes = await fs.readFile(outputPath);
      lastProcessedHash = computeBufferHash(writtenBytes);
    }
  } catch (error) {
    if (initialSpinner.isSpinning) {
      initialSpinner.fail("Initial edit failed");
    }
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
  }

  logger.info(
    chalk.blue(
      `\n[watch] Watching ${filePath} for changes (debounce: ${debounceMs}ms)... (Press Ctrl+C to exit)`
    )
  );

  const processChange = async () => {
    if (isEditing || signal?.aborted) {
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
      logger.info(
        chalk.yellow(`\n[watch] Change detected in ${filePath}. Sending to SuperDocs...`)
      );

      const spinner = logger.spinner("Processing change");
      const exportedBytes = await executeSingleEditCycle(
        filePath,
        options,
        command,
        prompt,
        logger,
        spinner,
        signal
      );

      if (exportedBytes) {
        lastProcessedHash = computeBufferHash(exportedBytes);
      } else {
        const writtenBytes = await fs.readFile(outputPath);
        lastProcessedHash = computeBufferHash(writtenBytes);
      }

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

  const watcher = watchFile({
    filePath,
    debounceMs,
    onChange: () => processChange(),
    onError: (err) => {
      logger.error(`[watch] Watcher error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      logger.info(chalk.gray("\n[watch] Stopping file watcher..."));
      watcher.close();
      resolve();
    };

    if (signal) {
      signal.addEventListener("abort", cleanup, { once: true });
    }

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}

function parsePositiveMs(value: string | undefined, option: string): number {
  const ms = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Error(`${option} must be a non-negative number of milliseconds.`);
  }

  return ms;
}
