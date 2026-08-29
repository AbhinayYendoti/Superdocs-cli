import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { CONFIG_KEYS } from "../config/configPath.js";
import { formatFriendlyError, formatFriendlyHint, getExitCode } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const SHELLS = ["bash", "zsh", "fish"] as const;
type Shell = (typeof SHELLS)[number];

const ROOT_COMMANDS = ["auth", "login", "logout", "status", "edit", "config", "completion", "help"];
const AUTH_COMMANDS = ["login", "logout", "status", "help"];
const CONFIG_COMMANDS = ["get", "set", "list", "help"];
const COMPLETION_COMMANDS = [...SHELLS, "install", "help"];
const GLOBAL_OPTIONS = [
  "--api-key",
  "--api-url",
  "--config",
  "--json",
  "--quiet",
  "--verbose",
  "--no-color",
  "--help",
  "--version"
];
const EDIT_OPTIONS = [
  "--prompt",
  "--output",
  "--format",
  "--session-id",
  "--model-tier",
  "--response-mode",
  "--thinking-depth",
  "--approve",
  "--timeout-seconds",
  "--poll-interval",
  "--no-auto-continue",
  "--watch",
  "--watch-debounce",
  "--dry-run",
  "--git",
  "--help"
];

export function registerCompletionCommand(program: Command): void {
  const completion = program
    .command("completion [shell]")
    .description("Print or install shell completion scripts")
    .summary("Manage shell completion")
    .addHelpText(
      "after",
      `

Examples:
  $ eval "$(superdocs completion bash)"
  $ superdocs completion zsh > ~/.zsh/completions/_superdocs
  $ superdocs completion fish > ~/.config/fish/completions/superdocs.fish
  $ superdocs completion install bash

Notes:
  The generated scripts complete commands, flags, shells, config keys, and known option values.`
    )
    .action((shell: string | undefined) => {
      if (!shell) {
        console.error("Error: missing shell. Expected bash, zsh, or fish.");
        console.error(
          "Fix: run `superdocs completion bash`, `superdocs completion zsh`, or `superdocs completion fish`."
        );
        process.exitCode = 2;
        return;
      }

      if (!isShell(shell)) {
        console.error(`Error: unsupported shell '${shell}'. Expected bash, zsh, or fish.`);
        process.exitCode = 2;
        return;
      }

      process.stdout.write(getCompletionScript(shell));
    });

  completion
    .command("install")
    .description("Install shell completion for this user")
    .argument("<shell>", "Shell: bash, zsh, fish")
    .action(function (this: Command, shell: string) {
      return runInstall(shell, this);
    });
}

function getCompletionScript(shell: Shell): string {
  switch (shell) {
    case "bash":
      return bashCompletion();
    case "zsh":
      return zshCompletion();
    case "fish":
      return fishCompletion();
  }
}

async function runInstall(shellValue: string, command: Command): Promise<void> {
  const logger = createLogger(command);
  try {
    if (!isShell(shellValue)) {
      throw new Error(`Unsupported shell '${shellValue}'. Expected bash, zsh, or fish.`);
    }

    const target = completionInstallPath(shellValue);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, getCompletionScript(shellValue), "utf8");

    if (logger.json) {
      logger.writeJson({ ok: true, shell: shellValue, path: target });
      return;
    }

    logger.success(`Installed ${shellValue} completion to ${target}`);
    const note = installNote(shellValue, target);
    if (note) {
      logger.info(chalk.gray(note));
    }
  } catch (error) {
    logger.error(formatFriendlyError(error), formatFriendlyHint(error));
    process.exitCode = getExitCode(error);
  }
}

function completionInstallPath(shell: Shell): string {
  const home = os.homedir();
  switch (shell) {
    case "bash":
      return path.join(home, ".local", "share", "bash-completion", "completions", "superdocs");
    case "zsh":
      return path.join(process.env.ZDOTDIR ?? home, ".zsh", "completions", "_superdocs");
    case "fish":
      return path.join(home, ".config", "fish", "completions", "superdocs.fish");
  }
}

function installNote(shell: Shell, target: string): string | undefined {
  switch (shell) {
    case "bash":
      return "Restart your shell. If bash-completion is not enabled, add `source ~/.local/share/bash-completion/completions/superdocs` to ~/.bashrc.";
    case "zsh":
      return `Ensure ${path.dirname(target)} is in fpath, then restart your shell.`;
    case "fish":
      return "Restart fish, or run `source ~/.config/fish/completions/superdocs.fish`.";
  }
}

function bashCompletion(): string {
  return `# superdocs completion for bash
_superdocs_completion() {
  local cur prev words cword command subcommand
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  words=("\${COMP_WORDS[@]}")
  cword="\${COMP_CWORD}"
  command="\${words[1]}"
  subcommand="\${words[2]}"

  case "\${prev}" in
    --format|--output-format)
      COMPREPLY=( $(compgen -W "markdown txt" -- "\${cur}") )
      return 0
      ;;
    --model-tier|default-model)
      COMPREPLY=( $(compgen -W "core turbo pro max" -- "\${cur}") )
      return 0
      ;;
    --response-mode|response-mode)
      COMPREPLY=( $(compgen -W "compact full" -- "\${cur}") )
      return 0
      ;;
    --thinking-depth)
      COMPREPLY=( $(compgen -W "fast balanced deep" -- "\${cur}") )
      return 0
      ;;
    --approve)
      COMPREPLY=( $(compgen -W "all ask" -- "\${cur}") )
      return 0
      ;;
    get|set)
      if [[ "\${command}" == "config" ]]; then
        COMPREPLY=( $(compgen -W "${CONFIG_KEYS.map((key) => key.replace(/_/gu, "-")).join(" ")}" -- "\${cur}") )
        return 0
      fi
      ;;
    install)
      if [[ "\${command}" == "completion" ]]; then
        COMPREPLY=( $(compgen -W "${SHELLS.join(" ")}" -- "\${cur}") )
        return 0
      fi
      ;;
  esac

  if [[ "\${cword}" == 1 ]]; then
    COMPREPLY=( $(compgen -W "${ROOT_COMMANDS.join(" ")} ${GLOBAL_OPTIONS.join(" ")}" -- "\${cur}") )
    return 0
  fi

  case "\${command}" in
    auth)
      COMPREPLY=( $(compgen -W "${AUTH_COMMANDS.join(" ")}" -- "\${cur}") )
      ;;
    edit)
      COMPREPLY=( $(compgen -W "${EDIT_OPTIONS.join(" ")}" -- "\${cur}") )
      ;;
    config)
      if [[ "\${cword}" == 2 ]]; then
        COMPREPLY=( $(compgen -W "${CONFIG_COMMANDS.join(" ")}" -- "\${cur}") )
      elif [[ "\${subcommand}" == "get" || "\${subcommand}" == "set" ]]; then
        COMPREPLY=( $(compgen -W "${CONFIG_KEYS.map((key) => key.replace(/_/gu, "-")).join(" ")}" -- "\${cur}") )
      fi
      ;;
    completion)
      COMPREPLY=( $(compgen -W "${COMPLETION_COMMANDS.join(" ")}" -- "\${cur}") )
      ;;
    *)
      COMPREPLY=( $(compgen -W "${GLOBAL_OPTIONS.join(" ")}" -- "\${cur}") )
      ;;
  esac
}
complete -F _superdocs_completion superdocs
`;
}

function zshCompletion(): string {
  return `#compdef superdocs
_superdocs() {
  local -a root_commands auth_commands config_commands completion_commands global_options edit_options config_keys
  root_commands=(${ROOT_COMMANDS.map((item) => quoteZsh(item)).join(" ")})
  auth_commands=(${AUTH_COMMANDS.map((item) => quoteZsh(item)).join(" ")})
  config_commands=(${CONFIG_COMMANDS.map((item) => quoteZsh(item)).join(" ")})
  completion_commands=(${COMPLETION_COMMANDS.map((item) => quoteZsh(item)).join(" ")})
  global_options=(${GLOBAL_OPTIONS.map((item) => quoteZsh(item)).join(" ")})
  edit_options=(${EDIT_OPTIONS.map((item) => quoteZsh(item)).join(" ")})
  config_keys=(${CONFIG_KEYS.map((key) => quoteZsh(key.replace(/_/gu, "-"))).join(" ")})

  case "$words[2]" in
    auth)
      _describe 'auth command' auth_commands
      ;;
    edit)
      _describe 'edit option' edit_options
      ;;
    config)
      if (( CURRENT == 3 )); then
        _describe 'config command' config_commands
      else
        case "$words[3]" in
          get|set) _describe 'config key' config_keys ;;
        esac
      fi
      ;;
    completion)
      _describe 'completion command' completion_commands
      ;;
    *)
      _describe 'command' root_commands || _describe 'global option' global_options
      ;;
  esac
}
_superdocs "$@"
`;
}

function fishCompletion(): string {
  const lines = [
    "complete -c superdocs -f",
    ...ROOT_COMMANDS.map(
      (command) =>
        `complete -c superdocs -n "__fish_use_subcommand" -a ${command} -d "${fishDescription(command)}"`
    ),
    ...GLOBAL_OPTIONS.map((option) => `complete -c superdocs -l ${option.replace(/^--/u, "")}`),
    ...AUTH_COMMANDS.map(
      (command) => `complete -c superdocs -n "__fish_seen_subcommand_from auth" -a ${command}`
    ),
    ...EDIT_OPTIONS.map(
      (option) =>
        `complete -c superdocs -n "__fish_seen_subcommand_from edit" -l ${option.replace(/^--/u, "")}`
    ),
    'complete -c superdocs -n "__fish_seen_subcommand_from config" -a "get set list help"',
    ...CONFIG_KEYS.map(
      (key) =>
        `complete -c superdocs -n "__fish_seen_subcommand_from get set" -a ${key.replace(/_/gu, "-")}`
    ),
    `complete -c superdocs -n "__fish_seen_subcommand_from completion" -a "${COMPLETION_COMMANDS.join(" ")}"`,
    `complete -c superdocs -n "__fish_seen_subcommand_from install" -a "${SHELLS.join(" ")}"`
  ];

  return `${lines.join("\n")}\n`;
}

function quoteZsh(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function fishDescription(command: string): string {
  switch (command) {
    case "auth":
      return "Manage authentication";
    case "edit":
      return "Edit a markdown or text file";
    case "config":
      return "Manage configuration";
    case "completion":
      return "Manage shell completion";
    default:
      return command;
  }
}

function isShell(value: string): value is Shell {
  return SHELLS.includes(value as Shell);
}
