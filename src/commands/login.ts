import { Command } from "commander";
import { createLogger, type Spinner } from "../utils/logger.js";

interface LoginOptions {
  apiKey?: string;
}

const API_KEY_HELP =
  "Use a SuperDocs API key for this login. Prefer the prompt to avoid shell history.";

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description("Sign in to SuperDocs")
    .summary("Authenticate with SuperDocs")
    .option("-k, --api-key <key>", API_KEY_HELP)
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
    .option("-k, --api-key <key>", API_KEY_HELP)
    .action(function (this: Command, options: LoginOptions) {
      return runLogin(options, this);
    });
}

async function runLogin(options: LoginOptions, command: Command): Promise<void> {
  const logger = createLogger(command);
  let spinner: Spinner | undefined;

  // Loaded here rather than at module scope: these pull in zod and the SDK,
  // which would otherwise sit on the startup path of every command.
  const [credentials, env, sdk, api, commandUtils, prompt, errors] = await Promise.all([
    import("../config/credentialsStore.js"),
    import("../config/env.js"),
    import("../sdk/index.js"),
    import("../types/api.js"),
    import("../utils/command.js"),
    import("../utils/prompt.js"),
    import("../utils/errors.js")
  ]);

  try {
    const global = commandUtils.getGlobalOptions(command);
    const rawKey =
      options.apiKey ?? global.apiKey ?? (await prompt.promptForText("SuperDocs API key: "));
    const apiKey = api.ApiKeySchema.parse(rawKey);
    const baseUrl = env.resolveBaseUrl(global);
    const credentialsPath = credentials.getCredentialsPath();

    spinner = logger.spinner("Verifying SuperDocs credentials").start();
    const client = new sdk.SuperDocsClient({
      apiKey,
      baseUrl,
      ...(logger.verbose ? { debug: (message: string) => logger.debug(message) } : {})
    });

    await client.verifyAuthentication();
    await credentials.saveApiKey(apiKey);
    process.env.SUPERDOCS_API_KEY = apiKey;

    const hardened = await credentials.restrictToCurrentUser(credentialsPath);

    if (logger.json) {
      logger.writeJson({ ok: true, credentialsPath, permissionsRestricted: hardened });
      return;
    }

    spinner.stop();
    logger.success("✓ Authentication successful.");
    logger.info("Credentials securely stored for future SuperDocs commands.");
    if (!hardened) {
      logger.warn(
        `Could not restrict permissions on ${credentialsPath}. Tighten access to this file manually.`
      );
    }
  } catch (error) {
    if (spinner?.isSpinning) {
      spinner.fail("Could not sign in to SuperDocs");
    }
    logger.error(errors.formatFriendlyError(error), errors.formatFriendlyHint(error));
    process.exitCode = errors.getExitCode(error);
  }
}
