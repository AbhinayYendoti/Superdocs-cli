import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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
