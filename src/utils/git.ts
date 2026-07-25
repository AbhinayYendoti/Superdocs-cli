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
  changedFiles: string[];
}

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
    const changedFiles = await getGitChangedFiles(cwd);
    return {
      isGitRepo: true,
      rootPath,
      changedFiles
    };
  } catch {
    return { isGitRepo: false, changedFiles: [] };
  }
}
