import fsSync, { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Path helpers and raw file access for the non-secret user config.
 *
 * This module deliberately avoids importing zod. `Logger` needs the `verbose`
 * default on every command, and pulling the schema layer in for that would put
 * ~140 ms of module loading on the startup path of `--version` and `--help`.
 * Validation still happens in `userConfig.ts`, which builds on these helpers.
 */

export const CONFIG_KEYS = [
  "default_model",
  "response_mode",
  "output_format",
  "timeout",
  "verbose"
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function getConfigHome(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    return process.env.APPDATA;
  }

  return path.join(os.homedir(), ".config");
}

export function getUserConfigPath(): string {
  const override = process.env.SUPERDOCS_CONFIG_PATH;
  if (override) {
    return path.resolve(override);
  }

  return path.join(getConfigHome(), "superdocs", "config.json");
}

export async function readConfigFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return "";
    }

    throw error;
  }
}

export function readConfigFileSync(filePath: string): string {
  try {
    return fsSync.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return "";
    }

    throw error;
  }
}

/**
 * Reads a single boolean preference without schema validation.
 * Used for bootstrap-time defaults that must not fail the command.
 */
export function readBooleanPreference(
  key: string,
  filePath = getUserConfigPath()
): boolean | undefined {
  try {
    const raw = readConfigFileSync(filePath);
    if (!raw) {
      return undefined;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }

    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
