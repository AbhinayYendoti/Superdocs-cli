import chalk from "chalk";
import { Command } from "commander";
import { readBooleanPreference } from "../config/configPath.js";
import type { GlobalOptions } from "../types/global.js";

export interface Spinner {
  text: string;
  readonly isSpinning: boolean;
  start(text?: string): Spinner;
  succeed(text?: string): Spinner;
  fail(text?: string): Spinner;
  stop(): Spinner;
}

export interface ILogger {
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly json: boolean;
  spinner(text: string): Spinner;
  progress(spinner: Spinner, message: string, detail?: Record<string, unknown>): void;
  /** Status text for humans. Always stderr, so stdout stays pipeable. */
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
  error(message: string, hint?: string): void;
  /** Primary payload the user asked for. Always stdout. */
  output(chunk: string | Uint8Array): void;
  writeJson(value: unknown): void;
}

/**
 * Stream contract:
 *   stdout - only the payload (edited document, diff, completion script, JSON)
 *   stderr - everything else (progress, status, hints, warnings, errors)
 *
 * This is what makes `superdocs edit ... > out.md` and `| jq` safe.
 */
export class Logger implements ILogger {
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly json: boolean;

  constructor(options: GlobalOptions = {}) {
    this.quiet = options.quiet ?? false;
    this.verbose = options.verbose ?? readBooleanPreference("verbose") ?? false;
    this.json = options.json ?? false;
  }

  spinner(text: string): Spinner {
    if (this.quiet || this.json || !process.stderr.isTTY) {
      return new NoopSpinner(text);
    }

    return new LazySpinner(text);
  }

  progress(spinner: Spinner, message: string, detail?: Record<string, unknown>): void {
    if (this.json) {
      if (this.verbose) {
        this.writeJson({ event: "progress", message, ...(detail ? { detail } : {}) });
      }
      return;
    }
    if (spinner.isSpinning) {
      spinner.text = message;
    } else {
      this.info(message);
    }
  }

  info(message: string): void {
    if (!this.quiet && !this.json) {
      process.stderr.write(`${message}\n`);
    }
  }

  success(message: string): void {
    this.info(chalk.green(message));
  }

  warn(message: string): void {
    if (!this.quiet && !this.json) {
      process.stderr.write(`${chalk.yellow(message)}\n`);
    }
  }

  debug(message: string): void {
    if (this.verbose) {
      process.stderr.write(`${chalk.gray(message)}\n`);
    }
  }

  error(message: string, hint?: string): void {
    if (this.json) {
      this.writeJson({ ok: false, error: message, ...(hint ? { hint } : {}) });
      return;
    }

    process.stderr.write(`${chalk.red("Error:")} ${message}\n`);
    if (hint) {
      process.stderr.write(`${chalk.bold("Fix:")} ${hint}\n`);
    }
  }

  output(chunk: string | Uint8Array): void {
    process.stdout.write(chunk);
  }

  /**
   * Emits newline-delimited JSON: one compact object per line, so a stream of
   * progress events plus a final result stays parseable by `jq -c` or any
   * line-oriented reader.
   */
  writeJson(value: unknown): void {
    const payload =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? { schema_version: JSON_SCHEMA_VERSION, ...(value as Record<string, unknown>) }
        : value;
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}

export const JSON_SCHEMA_VERSION = 1;

export function createLogger(command: Command): Logger {
  return new Logger(command.optsWithGlobals<GlobalOptions>());
}

interface OraLike {
  text: string;
  isSpinning: boolean;
  start(text?: string): OraLike;
  succeed(text?: string): OraLike;
  fail(text?: string): OraLike;
  stop(): OraLike;
}

/**
 * Defers `import("ora")` until a spinner is actually started. Loading ora costs
 * ~100 ms, which is pure waste for `--version`, `--help`, `--json`, and CI runs.
 * Rendering is cosmetic, so resolving it a tick late is not observable.
 */
class LazySpinner implements Spinner {
  private pendingText: string;
  private impl: OraLike | undefined;
  private wantsSpinning = false;
  private loading = false;

  constructor(text: string) {
    this.pendingText = text;
  }

  get text(): string {
    return this.impl ? this.impl.text : this.pendingText;
  }

  set text(value: string) {
    this.pendingText = value;
    if (this.impl) {
      this.impl.text = value;
    }
  }

  get isSpinning(): boolean {
    return this.impl ? this.impl.isSpinning : this.wantsSpinning;
  }

  start(text?: string): Spinner {
    if (text) {
      this.text = text;
    }
    this.wantsSpinning = true;

    if (this.impl) {
      this.impl.start(this.pendingText);
      return this;
    }

    if (!this.loading) {
      this.loading = true;
      void import("ora")
        .then(({ default: ora }) => {
          if (!this.wantsSpinning) {
            return;
          }
          this.impl = ora({ text: this.pendingText, discardStdin: false });
          this.impl.start();
        })
        .catch(() => {
          // A missing or broken spinner must never fail the command.
        });
    }

    return this;
  }

  succeed(text?: string): Spinner {
    return this.settle("succeed", chalk.green("✔"), text);
  }

  fail(text?: string): Spinner {
    return this.settle("fail", chalk.red("✖"), text);
  }

  stop(): Spinner {
    this.wantsSpinning = false;
    this.impl?.stop();
    return this;
  }

  private settle(method: "succeed" | "fail", symbol: string, text?: string): Spinner {
    if (text) {
      this.text = text;
    }
    this.wantsSpinning = false;

    if (this.impl) {
      this.impl[method](this.pendingText);
      return this;
    }

    // ora never finished loading; still give the user the final line.
    if (this.pendingText) {
      process.stderr.write(`${symbol} ${this.pendingText}\n`);
    }
    return this;
  }
}

class NoopSpinner implements Spinner {
  text: string;
  readonly isSpinning = false;

  constructor(text: string) {
    this.text = text;
  }

  start(text?: string): Spinner {
    if (text) {
      this.text = text;
    }
    return this;
  }

  succeed(text?: string): Spinner {
    if (text) {
      this.text = text;
    }
    return this;
  }

  fail(text?: string): Spinner {
    if (text) {
      this.text = text;
    }
    return this;
  }

  stop(): Spinner {
    return this;
  }
}
