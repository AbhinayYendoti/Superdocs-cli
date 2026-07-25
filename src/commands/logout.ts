import chalk from "chalk";
import { Command } from "commander";
import { removeEnvValue } from "../config/envFile.js";
import { getGlobalOptions } from "../utils/command.js";
import { createLogger } from "../utils/logger.js";

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Remove SUPERDOCS_API_KEY from .env")
    .summary("Clear saved authentication")
    .action(function (this: Command) {
      return runLogout(this);
    });
}

export function registerAuthLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Remove the saved SuperDocs API key")
    .action(function (this: Command) {
      return runLogout(this);
    });
}

async function runLogout(command: Command): Promise<void> {
  const logger = createLogger(command);
  const { envFile = ".env" } = getGlobalOptions(command);
  const removed = await removeEnvValue("SUPERDOCS_API_KEY", envFile);
  delete process.env.SUPERDOCS_API_KEY;

  if (logger.json) {
    logger.writeJson({ ok: true, envFile, removed });
    return;
  }

  if (removed) {
    logger.info(chalk.green(`Removed SUPERDOCS_API_KEY from ${envFile}.`));
  } else {
    logger.info(chalk.yellow(`No SUPERDOCS_API_KEY entry was found in ${envFile}.`));
  }
}
