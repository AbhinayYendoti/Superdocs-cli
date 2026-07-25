import dotenv from "dotenv";
import { ApiKeySchema } from "../types/api.js";
import type { GlobalOptions } from "../types/global.js";
import { MissingApiKeyError } from "../utils/errors.js";

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  envFile: string;
}

export function loadConfig(options: GlobalOptions = {}): AppConfig {
  loadEnv(options);
  const rawApiKey = options.apiKey ?? process.env.SUPERDOCS_API_KEY;
  const envFile = options.envFile ?? options.config ?? ".env";

  if (!rawApiKey) {
    throw new MissingApiKeyError();
  }

  return {
    apiKey: ApiKeySchema.parse(rawApiKey),
    baseUrl: (options.apiUrl ?? process.env.SUPERDOCS_API_BASE_URL ?? "https://api.superdocs.app")
      .trim()
      .replace(/\/+$/u, ""),
    envFile
  };
}

export function loadOptionalApiKey(options: GlobalOptions = {}): string | undefined {
  loadEnv(options);
  const rawApiKey = options.apiKey ?? process.env.SUPERDOCS_API_KEY;
  return rawApiKey ? ApiKeySchema.parse(rawApiKey) : undefined;
}

function loadEnv(options: GlobalOptions): void {
  dotenv.config({
    path: options.envFile ?? options.config ?? ".env",
    quiet: true,
    override: false
  });
}
