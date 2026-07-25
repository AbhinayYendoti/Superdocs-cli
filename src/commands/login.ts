import chalk from "chalk";
import { Command } from "commander";
import { setEnvValue } from "../config/envFile.js";
import { SuperDocsClient } from "../sdk/index.js";
import { ApiKeySchema } from "../types/api.js";
import { getGlobalOptions } from "../utils/command.js";
import { formatFriendlyError, formatFriendlyHint, getExitCode } from "../utils/errors.js";
import { createLogger, type Spinner } from "../utils/logger.js";
import { promptForText } from "../utils/prompt.js";

interface LoginOptions {
  apiKey?: string;
}

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Save and verify your SuperDocs API key in .env")
    .summary("Authenticate with SuperDocs")
    .option("-k, --api-key <key>", "SuperDocs API key. Prefer the prompt to avoid shell history.")
    .addHelpText(
      "after",
      `

Examples:
  $ superdocs auth login
  $ superdocs login --api-key "$SUPERDOCS_API_KEY"

Notes:
  The key is written to your env file as SUPERDOCS_API_KEY. The default env file is .env.`
    )
    .action(function (this: Command, options: LoginOptions) {
      return runLogin(options, this);
    });
}

export function registerAuthLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Save and verify your SuperDocs API key")
    .option("-k, --api-key <key>", "SuperDocs API key. Prefer the prompt to avoid shell history.")
    .action(function (this: Command, options: LoginOptions) {
      return runLogin(options, this);
    });
}

async function runLogin(options: LoginOptions, command: Command): Promise<void> {
  const logger = createLogger(command);
  const global = getGlobalOptions(command);
  let spinner: Spinner | undefined;

  try {
    const rawKey = options.apiKey ?? global.apiKey ?? (await promptForText("SuperDocs API key: "));
    const apiKey = ApiKeySchema.parse(rawKey);
    const baseUrl = global.apiUrl ?? "https://api.superdocs.app";
    const envFile = global.envFile ?? ".env";

    spinner = logger.spinner("Verifying SuperDocs API key").start();
    const client = new SuperDocsClient({
      apiKey,
      baseUrl,
      ...(logger.verbose ? { debug: (message) => logger.debug(message) } : {})
    });

    await client.verifyAuthentication();
    await setEnvValue("SUPERDOCS_API_KEY", apiKey, envFile);
    process.env.SUPERDOCS_API_KEY = apiKey;

    spinner.succeed(`SuperDocs API key saved to ${envFile}`);

    if (logger.json) {
      logger.writeJson({ ok: true, envFile });
      return;
    }

    logger.info(chalk.gray("Next: run `superdocs auth status` or `superdocs edit <file>`."));
  } catch (error) {
    if (spinner?.isSpinning) {
      spinner.fail("Authentication failed");
    }
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    process.exitCode = getExitCode(error);
  }
}
