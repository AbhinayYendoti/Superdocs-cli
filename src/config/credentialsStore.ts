import { execFile } from "node:child_process";
import fsSync, { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import envPaths from "env-paths";
import { z } from "zod";
import { ApiKeySchema } from "../types/api.js";

const execFileAsync = promisify(execFile);

const APP_NAME = "SuperDocs";
const CREDENTIALS_FILE = "credentials.json";
const CREDENTIALS_PATH_ENV = "SUPERDOCS_CREDENTIALS_PATH";

const CredentialsFileSchema = z
  .object({
    version: z.number().int().positive().optional(),
    apiKey: ApiKeySchema
  })
  .strict();

export function getCredentialsDirectory(): string {
  const paths = envPaths(APP_NAME, { suffix: "" });

  if (process.platform === "win32") {
    return path.dirname(paths.config);
  }

  if (process.platform === "darwin") {
    return paths.data;
  }

  return paths.config;
}

export function getCredentialsPath(): string {
  const override = process.env[CREDENTIALS_PATH_ENV];
  if (override) {
    return path.resolve(override);
  }

  return path.join(getCredentialsDirectory(), CREDENTIALS_FILE);
}

export async function saveApiKey(apiKey: string): Promise<void> {
  const credentialsPath = getCredentialsPath();
  const parsedApiKey = ApiKeySchema.parse(apiKey);

  await assertNotSymlink(credentialsPath);
  await fs.mkdir(path.dirname(credentialsPath), { recursive: true });
  await fs.writeFile(
    credentialsPath,
    `${JSON.stringify({ version: 1, apiKey: parsedApiKey }, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600
    }
  );
  await restrictToCurrentUser(credentialsPath);
}

/**
 * Restricts the credentials file to the current user.
 *
 * POSIX mode bits are a no-op on Windows, so `chmod(0o600)` alone left the API
 * key readable by anything running under the user's account and by anything
 * inheriting the parent directory's ACL. On win32 we drop inherited ACEs and
 * grant full control to the current account only.
 *
 * Returns false when hardening could not be applied, so callers may warn.
 */
export async function restrictToCurrentUser(filePath: string): Promise<boolean> {
  if (process.platform !== "win32") {
    try {
      await fs.chmod(filePath, 0o600);
      return true;
    } catch {
      return false;
    }
  }

  const account = currentWindowsAccount();
  if (!account) {
    return false;
  }

  try {
    await execFileAsync("icacls", [filePath, "/inheritance:r", "/grant:r", `${account}:F`], {
      windowsHide: true
    });
    return true;
  } catch {
    return false;
  }
}

function currentWindowsAccount(): string | undefined {
  const domain = process.env.USERDOMAIN;
  const user = process.env.USERNAME ?? safeUserInfoName();
  if (!user) {
    return undefined;
  }

  return domain ? `${domain}\\${user}` : user;
}

function safeUserInfoName(): string | undefined {
  try {
    return os.userInfo().username;
  } catch {
    return undefined;
  }
}

export function loadApiKey(): string | undefined {
  const credentialsPath = getCredentialsPath();
  const raw = readCredentialsFile(credentialsPath);
  if (!raw) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(raw);
  return CredentialsFileSchema.parse(parsed).apiKey;
}

export async function removeApiKey(): Promise<boolean> {
  const credentialsPath = getCredentialsPath();
  await assertNotSymlink(credentialsPath);

  try {
    await fs.rm(credentialsPath, { force: false });
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

export function hasCredentials(): boolean {
  return loadApiKey() !== undefined;
}

function readCredentialsFile(filePath: string): string {
  try {
    return fsSync.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return "";
    }

    throw error;
  }
}

async function assertNotSymlink(filePath: string): Promise<void> {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(
        `Refusing to use symlinked credentials file '${filePath}'. Remove the symlink or set ${CREDENTIALS_PATH_ENV}.`
      );
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
