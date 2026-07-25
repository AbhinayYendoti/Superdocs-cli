import type { ModelTier, ResponseMode, ThinkingDepth } from "./api.js";

export interface EditCommandOptions {
  prompt?: string;
  output?: string;
  sessionId?: string;
  modelTier?: ModelTier;
  responseMode?: ResponseMode;
  thinkingDepth?: ThinkingDepth;
  timeoutSeconds?: string;
  pollInterval?: string;
  noAutoContinue?: boolean;
  format?: string;
  watch?: boolean;
  watchDebounce?: string;
  dryRun?: boolean;
  git?: boolean;
}
