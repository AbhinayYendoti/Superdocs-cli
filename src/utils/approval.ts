import type { ApprovalChoice } from "../types/commands.js";

/**
 * Normalizes `--approve`. Returns undefined for unrecognized values so callers
 * can report a usage error rather than silently falling back to unattended mode.
 */
export function parseApproval(value: string | undefined): ApprovalChoice | undefined {
  const normalized = (value ?? "all").trim().toLowerCase();
  return normalized === "all" || normalized === "ask" ? normalized : undefined;
}

export function toApiApprovalMode(choice: ApprovalChoice): "approve_all" | "ask_every_time" {
  return choice === "ask" ? "ask_every_time" : "approve_all";
}
