import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitRepoInfo {
  isGitRepo: boolean;
  rootPath?: string;
  branch?: string;
  changedFiles: string[];
}

/** Keeps the injected context bounded so a large working tree cannot dominate the prompt. */
const MAX_CONTEXT_FILES = 50;

/**
 * Checks if the git executable is installed and available in PATH.
 */
export async function isGitAvailable(): Promise<boolean> {
  try {
    await execFileAsync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the top-level root directory of the current git repository.
 */
export async function getGitRepositoryRoot(cwd?: string): Promise<string> {
  if (!(await isGitAvailable())) {
    throw new GitError("Git is not installed or not available in your system PATH.");
  }

  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: cwd ?? process.cwd()
    });
    return path.resolve(stdout.trim());
  } catch {
    throw new GitError("Current directory is not inside a Git repository.");
  }
}

/**
 * Returns a list of modified, staged, and untracked files in the current repository.
 */
export async function getGitChangedFiles(cwd?: string): Promise<string[]> {
  if (!(await isGitAvailable())) {
    throw new GitError("Git is not installed or not available in your system PATH.");
  }

  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: cwd ?? process.cwd()
    });

    const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const files = lines.map((line) => {
      // Porcelain format: XY filename -> split at position 3
      const filePath = line.substring(3).trim();
      return filePath;
    });

    return [...new Set(files)];
  } catch {
    throw new GitError("Failed to retrieve changed files from Git repository.");
  }
}

/**
 * Returns the current branch name, or undefined when detached or unavailable.
 */
export async function getGitBranch(cwd?: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: cwd ?? process.cwd()
    });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detects if a text string represents a unified git diff snippet.
 */
export function isGitDiffContent(content: string): boolean {
  const trimmed = content.trim();
  if (
    trimmed.startsWith("diff --git") ||
    trimmed.startsWith("--- a/") ||
    (trimmed.includes("--- a/") && trimmed.includes("+++ b/"))
  ) {
    return true;
  }
  return false;
}

/**
 * Inspects Git context for the current workspace.
 */
export async function inspectGitContext(cwd?: string): Promise<GitRepoInfo> {
  if (!(await isGitAvailable())) {
    return { isGitRepo: false, changedFiles: [] };
  }

  try {
    const rootPath = await getGitRepositoryRoot(cwd);
    const [changedFiles, branch] = await Promise.all([getGitChangedFiles(cwd), getGitBranch(cwd)]);
    return {
      isGitRepo: true,
      rootPath,
      ...(branch ? { branch } : {}),
      changedFiles
    };
  } catch {
    return { isGitRepo: false, changedFiles: [] };
  }
}

/**
 * Renders repository state as a prompt preamble.
 *
 * Without this, `--git` only printed repo details to the terminal and threw them
 * away, so the model never saw the context the flag advertises.
 */
export function formatGitContext(info: GitRepoInfo): string | undefined {
  if (!info.isGitRepo) {
    return undefined;
  }

  const lines = ["Git context for this request:"];
  if (info.rootPath) {
    lines.push(`- Repository root: ${info.rootPath}`);
  }
  if (info.branch) {
    lines.push(`- Current branch: ${info.branch}`);
  }

  if (info.changedFiles.length === 0) {
    lines.push("- Working tree is clean.");
  } else {
    const shown = info.changedFiles.slice(0, MAX_CONTEXT_FILES);
    const remaining = info.changedFiles.length - shown.length;
    lines.push(`- Changed files (${info.changedFiles.length}):`);
    for (const file of shown) {
      lines.push(`  - ${file}`);
    }
    if (remaining > 0) {
      lines.push(`  - ...and ${remaining} more`);
    }
  }

  return lines.join("\n");
}
