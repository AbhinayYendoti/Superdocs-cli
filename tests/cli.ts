import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const cliEntry = path.join(projectRoot, "dist", "index.js");

export function assertBuilt(): void {
  if (!existsSync(cliEntry)) {
    throw new Error(
      `Missing ${cliEntry}. The end-to-end suite exercises the built artifact; run "npm run build" first.`
    );
  }
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Extra environment. Credential and config paths are always sandboxed. */
  env?: Record<string, string | undefined>;
  stdin?: string;
  cwd?: string;
  timeoutMs?: number;
  /** Sandbox directory holding credentials.json and config.json. */
  home: string;
}

/**
 * Builds the child environment. The developer's own SuperDocs credentials and
 * API URL are stripped first, then the test's overrides are applied, so a real
 * key in the ambient shell can never reach a run and a test's key is never
 * stripped by accident.
 */
function buildEnv(options: RunOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  delete env["SUPERDOCS_API_KEY"];
  delete env["SUPERDOCS_API_BASE_URL"];

  env["SUPERDOCS_CREDENTIALS_PATH"] = path.join(options.home, "credentials.json");
  env["SUPERDOCS_CONFIG_PATH"] = path.join(options.home, "config.json");
  env["NO_COLOR"] = "1";

  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Runs the shipped CLI as a real subprocess.
 *
 * Every run is sandboxed: credentials and preferences are redirected into a temp
 * directory so the suite can never read or clobber the developer's real login.
 */
export function runCli(args: string[], options: RunOptions): Promise<RunResult> {
  const env = buildEnv(options);

  const child = spawn(process.execPath, [cliEntry, ...args], {
    cwd: options.cwd ?? projectRoot,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  return collect(child, options.stdin, options.timeoutMs ?? 30_000);
}

function collect(
  child: ChildProcessWithoutNullStreams,
  stdin: string | undefined,
  timeoutMs: number
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
        reject(
          new Error(`CLI run timed out after ${timeoutMs} ms.\nstdout:${stdout}\nstderr:${stderr}`)
        );
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

/** Spawns the CLI without waiting, for long-running modes such as `--watch`. */
export function spawnCli(args: string[], options: RunOptions): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [cliEntry, ...args], {
    cwd: options.cwd ?? projectRoot,
    env: buildEnv(options),
    stdio: ["pipe", "pipe", "pipe"]
  });
}

const created: string[] = [];

export async function makeHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "superdocs-e2e-"));
  created.push(dir);
  return dir;
}

export async function cleanupHomes(): Promise<void> {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

export const TEST_API_KEY = "sk_e2etestkey123456";
