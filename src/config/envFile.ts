import { promises as fs } from "node:fs";
import path from "node:path";

const ENV_PATH = path.resolve(".env");

export async function setEnvValue(key: string, value: string, filePath = ENV_PATH): Promise<void> {
  const envPath = path.resolve(filePath);
  assertSafeEnvKey(key);
  await assertNotSymlink(envPath);
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  const existing = await readEnvFile(envPath);
  const lines = existing.length > 0 ? existing.split(/\r?\n/) : [];
  const assignment = `${key}=${quoteEnvValue(value)}`;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.trimStart().startsWith(`${key}=`)) {
      replaced = true;
      return assignment;
    }

    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(assignment);
  }

  await writeEnvFile(envPath, nextLines);
}

export async function removeEnvValue(key: string, filePath = ENV_PATH): Promise<boolean> {
  const envPath = path.resolve(filePath);
  assertSafeEnvKey(key);
  await assertNotSymlink(envPath);
  const existing = await readEnvFile(envPath);

  if (!existing) {
    return false;
  }

  const lines = existing.split(/\r?\n/);
  const nextLines = lines.filter((line) => !line.trimStart().startsWith(`${key}=`));
  const removed = nextLines.length !== lines.length;

  if (removed) {
    await writeEnvFile(envPath, nextLines);
  }

  return removed;
}

function assertSafeEnvKey(key: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
    throw new Error(`Invalid env key '${key}'.`);
  }
}

function quoteEnvValue(value: string): string {
  return JSON.stringify(value);
}

async function writeEnvFile(filePath: string, lines: string[]): Promise<void> {
  await fs.writeFile(filePath, `${lines.join("\n").replace(/\n+$/u, "")}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await fs.chmod(filePath, 0o600).catch(() => {});
}

async function readEnvFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
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
        `Refusing to use symlinked credentials file '${filePath}'. Choose a regular file with --config.`
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
