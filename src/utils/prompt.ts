import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptForText(question: string): Promise<string> {
  if (!input.isTTY) {
    throw new Error(
      "This command needs interactive input. Re-run it with the required flag instead."
    );
  }

  const rl = createInterface({ input, output });

  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
