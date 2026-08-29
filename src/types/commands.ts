import type { ModelTier, ResponseMode, ThinkingDepth } from "./api.js";

/** `--approve all` applies edits unattended; `--approve ask` requires confirmation. */
export type ApprovalChoice = "all" | "ask";

export interface EditCommandOptions {
  prompt?: string;
  output?: string;
  sessionId?: string;
  modelTier?: ModelTier;
  responseMode?: ResponseMode;
  thinkingDepth?: ThinkingDepth;
  timeoutSeconds?: string;
  pollInterval?: string;
  /**
   * Commander maps `--no-auto-continue` to `autoContinue: false`.
   * There is no `noAutoContinue` key; reading one silently disables the flag.
   */
  autoContinue?: boolean;
  approve?: ApprovalChoice;
  format?: string;
  watch?: boolean;
  watchDebounce?: string;
  dryRun?: boolean;
  git?: boolean;
}
