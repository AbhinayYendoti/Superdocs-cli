import chalk from "chalk";
import { Command } from "commander";
import {
  getUserConfigPath,
  getUserConfigValue,
  listUserConfig,
  setUserConfigValue
} from "../config/userConfig.js";
import { formatFriendlyError, formatFriendlyHint, getExitCode } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Manage SuperDocs CLI preferences")
    .summary("Manage configuration")
    .addHelpText(
      "after",
      `

Config keys:
  default-model     Model tier used by edit: core, turbo, pro, max
  response-mode     Response style: compact, full
  output-format     Default stdin/output format: markdown, txt
  timeout           Edit timeout in seconds
  verbose           Enable debug logs by default: true, false

Examples:
  $ superdocs config set default-model pro
  $ superdocs config get timeout
  $ superdocs config list`
    );

  config
    .command("get")
    .description("Print one config value")
    .argument("<key>", "Config key")
    .action(function (this: Command, key: string) {
      return runConfigAction(this, async () => {
        const logger = createLogger(this);
        const entry = await getUserConfigValue(key);
        if (logger.json) {
          logger.writeJson({ ok: true, key: entry.key, value: entry.value ?? null });
          return;
        }

        if (entry.value === undefined) {
          logger.info(`${entry.key.replace(/_/gu, "-")} is not set`);
          return;
        }

        logger.info(entry.value);
      });
    });

  config
    .command("set")
    .description("Save one config value")
    .argument("<key>", "Config key")
    .argument("<value>", "Config value")
    .action(function (this: Command, key: string, value: string) {
      return runConfigAction(this, async () => {
        const logger = createLogger(this);
        const entry = await setUserConfigValue(key, value);
        if (logger.json) {
          logger.writeJson({
            ok: true,
            key: entry.key,
            value: entry.value,
            configFile: getUserConfigPath()
          });
          return;
        }

        logger.success(`Set ${entry.key.replace(/_/gu, "-")} to ${entry.value}`);
        logger.info(chalk.gray(`Config file: ${getUserConfigPath()}`));
      });
    });

  config
    .command("list")
    .description("Print all config values")
    .action(function (this: Command) {
      return runConfigAction(this, async () => {
        const logger = createLogger(this);
        const entries = await listUserConfig();
        if (logger.json) {
          logger.writeJson({
            ok: true,
            configFile: getUserConfigPath(),
            values: Object.fromEntries(entries.map((entry) => [entry.key, entry.value ?? null]))
          });
          return;
        }

        for (const entry of entries) {
          logger.info(`${entry.key.replace(/_/gu, "-")}=${entry.value ?? ""}`);
        }
        logger.info(chalk.gray(`Config file: ${getUserConfigPath()}`));
      });
    });
}

async function runConfigAction(command: Command, action: () => Promise<void>): Promise<void> {
  const logger = createLogger(command);
  try {
    await action();
  } catch (error) {
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    process.exitCode = getExitCode(error);
  }
}
