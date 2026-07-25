import fsSync, { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ExportFormatSchema, ModelTierSchema, ResponseModeSchema } from "../types/api.js";

export const CONFIG_KEYS = [
  "default_model",
  "response_mode",
  "output_format",
  "timeout",
  "verbose"
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

const RawConfigSchema = z
  .object({
    version: z.number().int().positive().optional(),
    default_model: ModelTierSchema.optional(),
    response_mode: ResponseModeSchema.optional(),
    output_format: ExportFormatSchema.optional(),
    timeout: z.number().int().positive().optional(),
    verbose: z.boolean().optional()
  })
  .passthrough();

export type UserConfig = z.infer<typeof RawConfigSchema>;

export interface ConfigEntry {
  key: ConfigKey;
  value: string | undefined;
}

export function getUserConfigPath(): string {
  const override = process.env.SUPERDOCS_CONFIG_PATH;
  if (override) {
    return path.resolve(override);
  }

  return path.join(getConfigHome(), "superdocs", "config.json");
}

export async function loadUserConfig(filePath = getUserConfigPath()): Promise<UserConfig> {
  const raw = await readConfigFile(filePath);
  if (!raw) {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);
  return RawConfigSchema.parse(parsed);
}

export function loadUserConfigSync(filePath = getUserConfigPath()): UserConfig {
  const raw = readConfigFileSync(filePath);
  if (!raw) {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);
  return RawConfigSchema.parse(parsed);
}

export async function getUserConfigValue(
  key: string,
  filePath = getUserConfigPath()
): Promise<ConfigEntry> {
  const canonical = normalizeConfigKey(key);
  const config = await loadUserConfig(filePath);
  return {
    key: canonical,
    value: formatConfigValue(config[canonical])
  };
}

export async function setUserConfigValue(
  key: string,
  rawValue: string,
  filePath = getUserConfigPath()
): Promise<ConfigEntry> {
  const canonical = normalizeConfigKey(key);
  const value = parseConfigValue(canonical, rawValue);
  const existing = await loadUserConfig(filePath);
  const next = {
    ...existing,
    version: existing.version ?? 1,
    [canonical]: value
  };

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return {
    key: canonical,
    value: formatConfigValue(value)
  };
}

export async function listUserConfig(filePath = getUserConfigPath()): Promise<ConfigEntry[]> {
  const config = await loadUserConfig(filePath);
  return CONFIG_KEYS.map((key) => ({
    key,
    value: formatConfigValue(config[key])
  }));
}

export function normalizeConfigKey(key: string): ConfigKey {
  const normalized = key.trim().replace(/-/gu, "_");
  if (CONFIG_KEYS.includes(normalized as ConfigKey)) {
    return normalized as ConfigKey;
  }

  throw new Error(
    `Unknown config key '${key}'. Valid keys: ${CONFIG_KEYS.map((item) => item.replace(/_/gu, "-")).join(", ")}.`
  );
}

export function parseConfigValue(key: ConfigKey, rawValue: string): UserConfig[ConfigKey] {
  const value = rawValue.trim();
  if (!value) {
    throw new Error(`Config value for ${key.replace(/_/gu, "-")} cannot be empty.`);
  }

  switch (key) {
    case "default_model":
      return parseEnumValue(ModelTierSchema, value, "default-model", "core, turbo, pro, max");
    case "response_mode":
      return parseEnumValue(ResponseModeSchema, value, "response-mode", "compact, full");
    case "output_format":
      return parseEnumValue(ExportFormatSchema, value, "output-format", "markdown, txt");
    case "timeout": {
      const seconds = Number.parseInt(value, 10);
      if (!Number.isFinite(seconds) || seconds <= 0 || String(seconds) !== value) {
        throw new Error("timeout must be a positive whole number of seconds.");
      }
      return seconds;
    }
    case "verbose":
      return parseBoolean(value);
  }
}

function parseEnumValue<Schema extends z.ZodEnum>(
  schema: Schema,
  value: string,
  key: string,
  expected: string
): z.infer<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${key} must be one of: ${expected}.`);
  }

  return parsed.data;
}

function getConfigHome(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return process.env.XDG_CONFIG_HOME;
  }

  if (process.platform === "win32" && process.env.APPDATA) {
    return process.env.APPDATA;
  }

  return path.join(os.homedir(), ".config");
}

async function readConfigFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return "";
    }

    throw error;
  }
}

function readConfigFileSync(filePath: string): string {
  try {
    return fsSync.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return "";
    }

    throw error;
  }
}

function parseBoolean(value: string): boolean {
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error("verbose must be true or false.");
}

function formatConfigValue(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
