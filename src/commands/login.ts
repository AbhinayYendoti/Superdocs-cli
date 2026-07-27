import { Command } from "commander";
import { getCredentialsPath, saveApiKey } from "../config/credentialsStore.js";
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
    .description("Sign in to SuperDocs")
    .summary("Authenticate with SuperDocs")
    .option(
      "-k, --api-key <key>",
      "Use a SuperDocs API key for this login. Prefer the prompt to avoid shell history."
    )
    .addHelpText(
      "after",
      `

Examples:
  $ superdocs auth login
  $ superdocs login --api-key "$SUPERDOCS_API_KEY"

Notes:
  Your credentials are stored securely for future SuperDocs commands.`
    )
    .action(function (this: Command, options: LoginOptions) {
      return runLogin(options, this);
    });
}

export function registerAuthLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Sign in to SuperDocs")
    .option(
      "-k, --api-key <key>",
      "Use a SuperDocs API key for this login. Prefer the prompt to avoid shell history."
    )
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
    const credentialsPath = getCredentialsPath();

    spinner = logger.spinner("Verifying SuperDocs credentials").start();
    const client = new SuperDocsClient({
      apiKey,
      baseUrl,
      ...(logger.verbose ? { debug: (message) => logger.debug(message) } : {})
    });

    await client.verifyAuthentication();
    await saveApiKey(apiKey);
    process.env.SUPERDOCS_API_KEY = apiKey;

    if (logger.json) {
      logger.writeJson({ ok: true, credentialsPath });
      return;
    }

    spinner.stop();
    logger.success("✓ Authentication successful.");
    logger.info("Credentials securely stored for future SuperDocs commands.");
  } catch (error) {
    if (spinner?.isSpinning) {
      spinner.fail("Could not sign in to SuperDocs");
    }
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    process.exitCode = getExitCode(error);
  }
}
