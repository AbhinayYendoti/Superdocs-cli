import http from "node:http";
import type { Command } from "commander";
import type { ILogger, Spinner } from "../src/utils/logger.js";

export class TestSpinner implements Spinner {
  text = "";
  readonly isSpinning = false;

  start(text?: string): Spinner {
    if (text) this.text = text;
    return this;
  }

  succeed(text?: string): Spinner {
    if (text) this.text = text;
    return this;
  }

  fail(text?: string): Spinner {
    if (text) this.text = text;
    return this;
  }

  stop(): Spinner {
    return this;
  }
}

/**
 * Captures every logger channel separately so tests can assert the stdout/stderr
 * split rather than just "something was printed".
 */
export class TestLogger implements ILogger {
  readonly quiet = true;
  readonly verbose = false;
  readonly json: boolean;

  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  readonly jsonEvents: unknown[] = [];

  constructor(options: { json?: boolean } = {}) {
    this.json = options.json ?? false;
  }

  spinner(): Spinner {
    return new TestSpinner();
  }

  progress(): void {}

  info(message: string): void {
    this.stderr.push(message);
  }

  success(message: string): void {
    this.stderr.push(message);
  }

  warn(message: string): void {
    this.stderr.push(message);
  }

  debug(): void {}

  error(message: string, hint?: string): void {
    this.stderr.push(hint ? `${message} :: ${hint}` : message);
  }

  output(chunk: string | Uint8Array): void {
    this.stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
  }

  writeJson(value: unknown): void {
    this.jsonEvents.push(value);
  }

  stdoutText(): string {
    return this.stdout.join("");
  }

  stderrText(): string {
    return this.stderr.join("\n");
  }
}

export function fakeCommand(port: number | undefined): Command {
  return {
    optsWithGlobals() {
      return {
        ...(port === undefined ? {} : { apiKey: "sk_testtesttest" }),
        apiUrl: `http://127.0.0.1:${port ?? 9}`,
        quiet: true
      };
    }
  } as unknown as Command;
}

export function respondJson(response: http.ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

export function addressPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }

  return address.port;
}

export async function readRequestJson(
  request: http.IncomingMessage
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}
