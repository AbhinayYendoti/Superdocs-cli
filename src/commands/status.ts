import chalk from "chalk";
import { Command } from "commander";
import { SuperDocsClient } from "../sdk/index.js";
import { getGlobalOptions, loadConfigForCommand } from "../utils/command.js";
import { formatFriendlyError, formatFriendlyHint, getExitCode } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Check SuperDocs API health and API key authentication")
    .summary("Check API and auth status")
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
    .description("Check API health and authentication")
    .action(function (this: Command) {
      return runStatus(this);
    });
}

async function runStatus(command: Command): Promise<void> {
  const logger = createLogger(command);
  const spinner = logger.spinner("Checking SuperDocs status").start();

  try {
    const global = getGlobalOptions(command);
    const config = loadConfigForCommand(command);
    const client = new SuperDocsClient({
      ...config,
      ...(logger.verbose ? { debug: (message) => logger.debug(message) } : {})
    });

    const health = await client.health();
    await client.verifyAuthentication();

    spinner.succeed("SuperDocs is reachable and your API key is valid");

    if (logger.json) {
      logger.writeJson({
        ok: true,
        api: health.status,
        auth: "authenticated",
        apiUrl: config.baseUrl,
        envFile: config.envFile,
        keySource: global.apiKey ? "flag" : "environment"
      });
      return;
    }

    logger.info(`${chalk.bold("API:")} ${health.status}`);
    logger.info(`${chalk.bold("Auth:")} ${chalk.green("authenticated")}`);
    logger.info(`${chalk.bold("API URL:")} ${config.baseUrl}`);
    logger.info(`${chalk.bold("Env file:")} ${config.envFile}`);
  } catch (error) {
    spinner.fail("SuperDocs status check failed");
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    process.exitCode = getExitCode(error);
  }
}
