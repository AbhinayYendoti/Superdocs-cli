import { createInterface } from "node:readline/promises";
import { stdin as input, stderr, stdout as output } from "node:process";

export async function promptForText(question: string): Promise<string> {
  if (!input.isTTY) {
    throw new Error(
      "SuperDocs needs an API key to sign in. Run `superdocs auth login` in an interactive terminal, or pass `--api-key`."
    );
  }

  const rl = createInterface({ input, output });

  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Yes/no confirmation. Prompts on stderr so it never contaminates piped stdout.
 * Returns false in non-interactive terminals rather than blocking a CI run.
 */
export async function confirm(question: string): Promise<boolean> {
  if (!input.isTTY) {
    return false;
  }

  const rl = createInterface({ input, output: stderr });

  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
