import chalk from "chalk";
import { Command } from "commander";
import { SuperDocsClient } from "../sdk/index.js";
import { loadConfigForCommand } from "../utils/command.js";
import { formatFriendlyError, formatFriendlyHint, getExitCode } from "../utils/errors.js";
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
  const spinner = logger.spinner("Checking SuperDocs connection").start();

  try {
    const config = loadConfigForCommand(command);
    const client = new SuperDocsClient({
      ...config,
      ...(logger.verbose ? { debug: (message) => logger.debug(message) } : {})
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
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    process.exitCode = getExitCode(error);
  }
}
