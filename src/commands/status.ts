import chalk from "chalk";
import { Command } from "commander";
import { createLogger } from "../utils/logger.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Check your SuperDocs connection and sign-in status")
    .summary("Check connection and sign-in status")
    .addHelpText(
      "after",
      `

Examples:
  $ superdocs auth status
  $ superdocs status --json
  $ superdocs --api-url https://api.superdocs.app status`
    )
    .action(function (this: Command) {
      return runStatus(this);
    });
}

export function registerAuthStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Check your SuperDocs connection and sign-in status")
    .action(function (this: Command) {
      return runStatus(this);
    });
}

async function runStatus(command: Command): Promise<void> {
  const logger = createLogger(command);

  // Deferred so `--help` and `--version` never pay for zod and the SDK.
  const [sdk, commandUtils, errors] = await Promise.all([
    import("../sdk/index.js"),
    import("../utils/command.js"),
    import("../utils/errors.js")
  ]);

  const spinner = logger.spinner("Checking SuperDocs connection").start();

  try {
    const config = commandUtils.loadConfigForCommand(command);
    const client = new sdk.SuperDocsClient({
      ...config,
      ...(logger.verbose ? { debug: (message: string) => logger.debug(message) } : {})
    });

    const health = await client.health();
    await client.verifyAuthentication();

    spinner.succeed("SuperDocs is ready");

    if (logger.json) {
      logger.writeJson({
        ok: true,
        api: health.status,
        auth: "authenticated",
        apiUrl: config.baseUrl,
        credentialsPath: config.credentialsPath,
        keySource: config.keySource
      });
      return;
    }

    logger.info(`${chalk.bold("Connection:")} ${health.status}`);
    logger.info(`${chalk.bold("Authentication:")} ${chalk.green("signed in")}`);
  } catch (error) {
    spinner.fail("SuperDocs is not ready");
    logger.error(errors.formatFriendlyError(error), errors.formatFriendlyHint(error));
    process.exitCode = errors.getExitCode(error);
  }
}
