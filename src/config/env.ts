import { getCredentialsPath, loadApiKey } from "./credentialsStore.js";
import { ApiKeySchema } from "../types/api.js";
import type { GlobalOptions } from "../types/global.js";
import { MissingApiKeyError } from "../utils/errors.js";

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  credentialsPath: string;
  keySource: "flag" | "environment" | "credentials-store";
}

export const DEFAULT_BASE_URL = "https://api.superdocs.app";

/**
 * Precedence: --api-url, then SUPERDOCS_API_BASE_URL, then the public API.
 *
 * `--api-url` must not carry a Commander default. With one, `options.apiUrl` is
 * always set and the environment variable is silently ignored, which sent
 * self-hosted traffic to the public API.
 */
export function resolveBaseUrl(options: GlobalOptions = {}): string {
  return (options.apiUrl ?? process.env.SUPERDOCS_API_BASE_URL ?? DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/u, "");
}

export function loadConfig(options: GlobalOptions = {}): AppConfig {
  const keySource: AppConfig["keySource"] = options.apiKey
    ? "flag"
    : process.env.SUPERDOCS_API_KEY
      ? "environment"
      : "credentials-store";
  const rawApiKey =
    keySource === "credentials-store"
      ? loadApiKey()
      : (options.apiKey ?? process.env.SUPERDOCS_API_KEY);

  if (!rawApiKey) {
    throw new MissingApiKeyError();
  }

  return {
    apiKey: ApiKeySchema.parse(rawApiKey),
    baseUrl: resolveBaseUrl(options),
    credentialsPath: getCredentialsPath(),
    keySource
  };
}

export function loadOptionalApiKey(options: GlobalOptions = {}): string | undefined {
  const rawApiKey = options.apiKey ?? process.env.SUPERDOCS_API_KEY ?? loadApiKey();
  return rawApiKey ? ApiKeySchema.parse(rawApiKey) : undefined;
}
