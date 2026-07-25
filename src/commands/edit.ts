import chalk from "chalk";
import { Command } from "commander";
import type { EditCommandOptions } from "../types/commands.js";
import { formatFriendlyError, formatFriendlyHint, getExitCode } from "../utils/errors.js";
import { createLogger, type ILogger } from "../utils/logger.js";
import { promptForText } from "../utils/prompt.js";

export function registerEditCommand(program: Command): void {
  program
    .command("edit [file]")
    .description("Edit a local markdown or text file with SuperDocs")
    .summary("Edit a file in place")
    .option("-p, --prompt <prompt>", "Editing instruction to apply")
    .option("-o, --output <file>", "Write edited output to this path instead of overwriting input")
    .option("--format <format>", "Input format when reading from stdin: markdown, txt")
    .option("--session-id <id>", "Reuse a specific SuperDocs session ID")
    .option("--model-tier <tier>", "Model tier: core, turbo, pro, max")
    .option("--response-mode <mode>", "Response mode: compact, full")
    .option("--thinking-depth <depth>", "Thinking depth: fast, balanced, deep")
    .option("--timeout-seconds <seconds>", "Maximum time to wait for the edit")
    .option("--poll-interval <seconds>", "Seconds between job status checks", "2")
    .option("--no-auto-continue", "Do not auto-continue large edits if SuperDocs pauses")
    .option("-w, --watch", "Watch input file for changes and automatically edit")
    .option("--watch-debounce <ms>", "Debounce interval in milliseconds for watch mode", "300")
    .option("-d, --dry-run", "Preview proposed changes as a unified diff without writing to disk")
    .option("--git", "Inspect Git repository context and changed files")
    .addHelpText(
      "after",
      `

Examples:
  $ superdocs edit ./proposal.md --prompt "Make this more concise"
  $ superdocs edit ./notes.txt -p "Turn these notes into polished meeting minutes"
  $ superdocs edit ./draft.md --output ./draft.edited.md --model-tier pro --thinking-depth deep
  $ superdocs edit ./README.md --dry-run --prompt "Fix typos"
  $ superdocs edit ./README.md --watch
  $ cat proposal.md | superdocs edit --prompt "Make this concise"
  $ git diff | superdocs edit --prompt "Write release notes"
  $ git diff | superdocs edit --prompt "Summarise this PR"
  $ superdocs edit --git --prompt "Review changed files"

Notes:
  The command preserves your file extension by exporting the edited session as markdown or text.
  Use --output to avoid overwriting the input file.
  When reading from stdin, output defaults to stdout unless --output is specified.
  Use --format to set the input format when reading from stdin (default: markdown, or txt for Git diffs).
  Configured defaults can be set with superdocs config set default-model|response-mode|output-format|timeout.
  Dry run (-d, --dry-run) displays a colorized unified diff without modifying files.
  Watch mode (-w, --watch) monitors the file for edits, debounces changes, and updates output automatically.
  Piping git diff auto-detects diff format for generating release notes and summaries.`
    )
    .action(function (this: Command, file: string | undefined, options: EditCommandOptions) {
      return runEdit(file, options, this);
    });
}

async function runEdit(
  file: string | undefined,
  options: EditCommandOptions,
  command: Command
): Promise<void> {
  const logger = createLogger(command);
  const isStdinMode = !file;

  if (options.watch && isStdinMode) {
    logger.error("--watch requires a file path and cannot be used with stdin piping.");
    process.exitCode = 2;
    return;
  }

  if (options.git) {
    const { inspectGitContext } = await import("../utils/git.js");
    const gitInfo = await inspectGitContext();
    if (!gitInfo.isGitRepo) {
      logger.error(
        "Git integration error: Current directory is not a Git repository or Git is not installed."
      );
      process.exitCode = 2;
      return;
    }
    logger.info(chalk.bold(`[git] Repository root: ${gitInfo.rootPath}`));
    logger.info(
      chalk.gray(
        `[git] Changed files (${gitInfo.changedFiles.length}): ${gitInfo.changedFiles.join(", ") || "none"}`
      )
    );
  }

  if (isStdinMode && process.stdin.isTTY) {
    logger.error(
      "No file argument provided and stdin is a terminal.\n" +
        "Pipe content via stdin or provide a file path.\n" +
        'Example: cat file.md | superdocs edit --prompt "Make this concise"\n' +
        '         git diff | superdocs edit --prompt "Write release notes"'
    );
    process.exitCode = 2;
    return;
  }

  const prompt = await resolvePrompt(options.prompt, isStdinMode);

  // Setup AbortController for Ctrl+C cancellation
  const abortController = new AbortController();
  const handleSigInt = () => {
    logger.info(chalk.yellow("\nEdit cancelled. Cleaning up..."));
    abortController.abort();
  };

  process.once("SIGINT", handleSigInt);

  try {
    if (options.watch && file) {
      const { runWatchMode } = await import("./editWatch.js");
      await runWatchMode(file, options, command, prompt, logger, abortController.signal);
    } else {
      await runSingleEditMode(file, options, command, prompt, logger, abortController.signal);
    }
  } finally {
    process.removeListener("SIGINT", handleSigInt);
  }
}

async function runSingleEditMode(
  file: string | undefined,
  options: EditCommandOptions,
  command: Command,
  prompt: string,
  logger: ILogger,
  signal: AbortSignal
): Promise<void> {
  const spinner = logger.spinner("Preparing edit");
  try {
    const { executeSingleEditCycle } = await import("./editSingle.js");
    await executeSingleEditCycle(file, options, command, prompt, logger, spinner, signal);
  } catch (error) {
    if (spinner.isSpinning) {
      spinner.fail("Edit failed");
    }
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    process.exitCode = getExitCode(error);
  }
}

async function resolvePrompt(prompt: string | undefined, isStdinMode: boolean): Promise<string> {
  if (isStdinMode && !prompt) {
    throw new Error(
      "--prompt is required when reading from stdin.\n" +
        'Example: cat file.md | superdocs edit --prompt "Make this concise"\n' +
        '         git diff | superdocs edit --prompt "Write release notes"'
    );
  }

  if (!prompt && !process.stdin.isTTY) {
    throw new Error(
      "--prompt is required in non-interactive terminals.\n" +
        'Example: superdocs edit file.md --prompt "Make this concise"'
    );
  }

  const value = prompt ?? (await promptForText("Edit prompt: "));

  if (!value.trim()) {
    throw new Error("Edit prompt cannot be empty.");
  }

  return value.trim();
}
