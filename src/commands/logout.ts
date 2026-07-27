import chalk from "chalk";
import { Command } from "commander";
import { getCredentialsPath, removeApiKey } from "../config/credentialsStore.js";
import { createLogger } from "../utils/logger.js";

export function registerLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Sign out of SuperDocs")
    .summary("Sign out of SuperDocs")
    .action(function (this: Command) {
      return runLogout(this);
    });
}

export function registerAuthLogoutCommand(program: Command): void {
  program
    .command("logout")
    .description("Sign out of SuperDocs")
    .action(function (this: Command) {
      return runLogout(this);
    });
}

async function runLogout(command: Command): Promise<void> {
  const logger = createLogger(command);
  const credentialsPath = getCredentialsPath();
  const removed = await removeApiKey();
  delete process.env.SUPERDOCS_API_KEY;

  if (logger.json) {
    logger.writeJson({ ok: true, credentialsPath, removed });
    return;
  }

  if (removed) {
    logger.info(chalk.green("Signed out of SuperDocs. Stored credentials were removed."));
  } else {
    logger.info(chalk.yellow("No stored SuperDocs credentials found. You are already signed out."));
  }
}
