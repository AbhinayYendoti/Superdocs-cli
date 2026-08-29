#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { Command } from "commander";
import { registerCommands } from "./commands/index.js";
import {
  formatFriendlyError,
  formatFriendlyHint,
  getExitCode,
  printError
} from "./utils/errors.js";
import { ExitCode } from "./utils/exitCodes.js";
import { createLogger } from "./utils/logger.js";

/**
 * Read the shipped package version at runtime rather than hardcoding it.
 * A literal here silently drifts on every release bump.
 */
function resolveVersion(): string {
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(moduleDir, "..", "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version.length > 0) {
        return version;
      }
    }
  } catch {
    // Fall through to the sentinel below.
  }

  return "0.0.0-unknown";
}

const program = new Command();

program
  .name("superdocs")
  .description("Official command line interface for SuperDocs")
  .version(resolveVersion())
  .showHelpAfterError()
  .showSuggestionAfterError()
  .option("-k, --api-key <key>", "Use a SuperDocs API key for this command.")
  // No Commander default here on purpose: a default would always populate
  // `options.apiUrl` and permanently shadow SUPERDOCS_API_BASE_URL.
  .option(
    "--api-url <url>",
    "SuperDocs API base URL. Defaults to SUPERDOCS_API_BASE_URL, then https://api.superdocs.app."
  )
  .option(
    "-c, --config <path>",
    "Deprecated. Credentials are stored in the global SuperDocs directory."
  )
  .option("--json", "Print machine-readable JSON output.")
  .option("-q, --quiet", "Suppress non-essential output.")
  .option("-v, --verbose", "Print debug logs.")
  .option("--no-color", "Disable colored output.")
  .addHelpText(
    "after",
    `

Core commands:
  auth login          Sign in to SuperDocs
  auth status         Check connection and sign-in status
  config list         Show saved CLI preferences
  edit <file>         Edit a local markdown or text file

Examples:
  $ superdocs auth login
  $ superdocs config set default-model pro
  $ superdocs status
  $ superdocs edit ./proposal.md --prompt "Make this more concise"
  $ superdocs --json status

Configuration:
  SUPERDOCS_API_KEY       Optional credentials override for automation
  SUPERDOCS_API_BASE_URL  Override the API URL for development or self-hosted use
  superdocs auth login    Stores credentials in the global SuperDocs directory
  superdocs config        Stores non-secret preferences outside the credentials file`
  )
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true
  });

program.configureOutput({
  outputError: (message) => {
    console.error(chalk.red(message.trimEnd()));
  }
});

program.exitOverride();

program.hook("preAction", (thisCommand) => {
  const options = thisCommand.optsWithGlobals<{ color?: boolean }>();
  if (options.color === false) {
    chalk.level = 0;
  }
});

registerCommands(program);

await program.parseAsync(process.argv).catch((error: unknown) => {
  const exitCode = getExitCode(error);
  if (exitCode === ExitCode.Ok) {
    return;
  }

  const logger = createLogger(program);

  if (logger.json) {
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
  } else {
    printError(error);
  }

  process.exitCode = exitCode;
});
