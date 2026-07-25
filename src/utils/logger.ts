import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { loadUserConfigSync } from "../config/userConfig.js";
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
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
  error(message: string, hint?: string): void;
  writeJson(value: unknown): void;
}

export class Logger implements ILogger {
  readonly quiet: boolean;
  readonly verbose: boolean;
  readonly json: boolean;

  constructor(options: GlobalOptions = {}) {
    this.quiet = options.quiet ?? false;
    this.verbose = options.verbose ?? loadVerboseDefault();
    this.json = options.json ?? false;
  }

  spinner(text: string): Spinner {
    if (this.quiet || this.json || !process.stderr.isTTY) {
      return new NoopSpinner(text);
    }

    return ora({
      text,
      discardStdin: false
    });
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
      console.log(message);
    }
  }

  success(message: string): void {
    this.info(chalk.green(message));
  }

  warn(message: string): void {
    if (!this.quiet && !this.json) {
      console.warn(chalk.yellow(message));
    }
  }

  debug(message: string): void {
    if (this.verbose) {
      console.error(chalk.gray(message));
    }
  }

  error(message: string, hint?: string): void {
    if (this.json) {
      this.writeJson({ ok: false, error: message, ...(hint ? { hint } : {}) });
      return;
    }

    console.error(`${chalk.red("Error:")} ${message}`);
    if (hint) {
      console.error(`${chalk.bold("Fix:")} ${hint}`);
    }
  }

  writeJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
  }
}

export function createLogger(command: Command): Logger {
  return new Logger(command.optsWithGlobals<GlobalOptions>());
}

function loadVerboseDefault(): boolean {
  try {
    return loadUserConfigSync().verbose ?? false;
  } catch {
    return false;
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
