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
    baseUrl: (options.apiUrl ?? process.env.SUPERDOCS_API_BASE_URL ?? "https://api.superdocs.app")
      .trim()
      .replace(/\/+$/u, ""),
    credentialsPath: getCredentialsPath(),
    keySource
  };
}

export function loadOptionalApiKey(options: GlobalOptions = {}): string | undefined {
  const rawApiKey = options.apiKey ?? process.env.SUPERDOCS_API_KEY ?? loadApiKey();
  return rawApiKey ? ApiKeySchema.parse(rawApiKey) : undefined;
}
