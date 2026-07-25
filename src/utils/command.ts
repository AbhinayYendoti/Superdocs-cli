import { Command } from "commander";
import { loadConfig, type AppConfig } from "../config/env.js";
import { SuperDocsClient } from "../sdk/index.js";
import type { GlobalOptions } from "../types/global.js";
import { createLogger } from "./logger.js";

export function getGlobalOptions(command: Command): GlobalOptions {
  const options = command.optsWithGlobals<GlobalOptions>();
  const envFile = options.envFile ?? options.config;
  return envFile ? { ...options, envFile } : options;
}

export function loadConfigForCommand(command: Command): AppConfig {
  return loadConfig(getGlobalOptions(command));
}

export function createClientForCommand(
  command: Command,
  options: { timeoutMs?: number } = {}
): SuperDocsClient {
  const logger = createLogger(command);
  return new SuperDocsClient({
    ...loadConfigForCommand(command),
    ...options,
    ...(logger.verbose ? { debug: (message) => logger.debug(message) } : {})
  });
}
