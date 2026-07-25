import { Command } from "commander";
import { registerCompletionCommand } from "./completion.js";
import { registerConfigCommand } from "./config.js";
import { registerEditCommand } from "./edit.js";
import { registerAuthLoginCommand, registerLoginCommand } from "./login.js";
import { registerAuthLogoutCommand, registerLogoutCommand } from "./logout.js";
import { registerAuthStatusCommand, registerStatusCommand } from "./status.js";

export function registerCommands(program: Command): void {
  registerAuthCommands(program);
  registerLoginCommand(program);
  registerLogoutCommand(program);
  registerStatusCommand(program);
  registerEditCommand(program);
  registerCompletionCommand(program);
  registerConfigCommand(program);
}

function registerAuthCommands(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage SuperDocs authentication")
    .summary("Manage authentication")
    .addHelpText(
      "after",
      `

Examples:
  $ superdocs auth login
  $ superdocs auth status
  $ superdocs auth logout`
    );

  registerAuthLoginCommand(auth);
  registerAuthStatusCommand(auth);
  registerAuthLogoutCommand(auth);
}
