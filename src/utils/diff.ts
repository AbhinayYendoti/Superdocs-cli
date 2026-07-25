import chalk from "chalk";

export interface DiffOptions {
  filename?: string;
  contextLines?: number;
  color?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

/**
 * Generates a unified diff between two text strings.
 */
export function generateUnifiedDiff(
  originalText: string,
  modifiedText: string,
  options: DiffOptions = {}
): string {
  const filename = options.filename ?? "document";
  const contextSize = options.contextLines ?? 3;
  const useColor = options.color ?? true;

  // If contents are identical, return empty string immediately
  if (originalText === modifiedText) {
    return "";
  }

  const oldLines = originalText.split(/\r?\n/);
  const newLines = modifiedText.split(/\r?\n/);

  const edits = computeLineEditsOptimized(oldLines, newLines);
  const hunks = buildHunks(edits, contextSize);

  if (hunks.length === 0) {
    return "";
  }

  const output: string[] = [];

  // Header
  const headerOld = `--- a/${filename}`;
  const headerNew = `+++ b/${filename}`;
  if (useColor) {
    output.push(chalk.bold(headerOld));
    output.push(chalk.bold(headerNew));
  } else {
    output.push(headerOld);
    output.push(headerNew);
  }

  for (const hunk of hunks) {
    const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    output.push(useColor ? chalk.cyan(hunkHeader) : hunkHeader);

    for (const line of hunk.lines) {
      if (line.startsWith("-")) {
        output.push(useColor ? chalk.red(line) : line);
      } else if (line.startsWith("+")) {
        output.push(useColor ? chalk.green(line) : line);
      } else {
        output.push(line);
      }
    }
  }

  return output.join("\n");
}

type EditOperation =
  | { type: "equal"; line: string; oldIdx: number; newIdx: number }
  | { type: "delete"; line: string; oldIdx: number }
  | { type: "insert"; line: string; newIdx: number };

function computeLineEditsOptimized(oldLines: string[], newLines: string[]): EditOperation[] {
  const m = oldLines.length;
  const n = newLines.length;

  // 1. Trim common prefix
  let prefixCount = 0;
  while (prefixCount < m && prefixCount < n && oldLines[prefixCount] === newLines[prefixCount]) {
    prefixCount++;
  }

  // 2. Trim common suffix
  let suffixCount = 0;
  while (
    suffixCount < m - prefixCount &&
    suffixCount < n - prefixCount &&
    oldLines[m - 1 - suffixCount] === newLines[n - 1 - suffixCount]
  ) {
    suffixCount++;
  }

  const prefixEdits: EditOperation[] = [];
  for (let idx = 0; idx < prefixCount; idx++) {
    prefixEdits.push({
      type: "equal",
      line: oldLines[idx]!,
      oldIdx: idx + 1,
      newIdx: idx + 1
    });
  }

  const suffixEdits: EditOperation[] = [];
  for (let idx = 0; idx < suffixCount; idx++) {
    const oldIdx = m - suffixCount + idx + 1;
    const newIdx = n - suffixCount + idx + 1;
    suffixEdits.push({
      type: "equal",
      line: oldLines[oldIdx - 1]!,
      oldIdx,
      newIdx
    });
  }

  // Middle changed slice
  const middleOld = oldLines.slice(prefixCount, m - suffixCount);
  const middleNew = newLines.slice(prefixCount, n - suffixCount);

  const middleEdits = computeMiddleSliceEdits(middleOld, middleNew, prefixCount);

  return [...prefixEdits, ...middleEdits, ...suffixEdits];
}

function computeMiddleSliceEdits(
  oldSlice: string[],
  newSlice: string[],
  offset: number
): EditOperation[] {
  const m = oldSlice.length;
  const n = newSlice.length;

  if (m === 0 && n === 0) return [];

  if (m === 0) {
    return newSlice.map((line, idx) => ({
      type: "insert" as const,
      line,
      newIdx: offset + idx + 1
    }));
  }

  if (n === 0) {
    return oldSlice.map((line, idx) => ({
      type: "delete" as const,
      line,
      oldIdx: offset + idx + 1
    }));
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (oldSlice[i] === newSlice[j]) {
        dp[i + 1]![j + 1] = dp[i]![j]! + 1;
      } else {
        dp[i + 1]![j + 1] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const edits: EditOperation[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldSlice[i - 1] === newSlice[j - 1]) {
      edits.push({
        type: "equal",
        line: oldSlice[i - 1]!,
        oldIdx: offset + i,
        newIdx: offset + j
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      edits.push({
        type: "insert",
        line: newSlice[j - 1]!,
        newIdx: offset + j
      });
      j--;
    } else if (i > 0 && (j === 0 || dp[i]![j - 1]! < dp[i - 1]![j]!)) {
      edits.push({
        type: "delete",
        line: oldSlice[i - 1]!,
        oldIdx: offset + i
      });
      i--;
    }
  }

  return edits.reverse();
}

function buildHunks(edits: EditOperation[], contextSize: number): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const changedIndices: number[] = [];

  for (let idx = 0; idx < edits.length; idx++) {
    if (edits[idx]!.type !== "equal") {
      changedIndices.push(idx);
    }
  }

  if (changedIndices.length === 0) {
    return [];
  }

  const ranges: { start: number; end: number }[] = [];
  let currentRange = {
    start: Math.max(0, changedIndices[0]! - contextSize),
    end: Math.min(edits.length - 1, changedIndices[0]! + contextSize)
  };

  for (let k = 1; k < changedIndices.length; k++) {
    const idx = changedIndices[k]!;
    const nextStart = Math.max(0, idx - contextSize);
    const nextEnd = Math.min(edits.length - 1, idx + contextSize);

    if (nextStart <= currentRange.end + 1) {
      currentRange.end = Math.max(currentRange.end, nextEnd);
    } else {
      ranges.push(currentRange);
      currentRange = { start: nextStart, end: nextEnd };
    }
  }
  ranges.push(currentRange);

  for (const range of ranges) {
    const slice = edits.slice(range.start, range.end + 1);
    let oldStart = 0;
    let oldLinesCount = 0;
    let newStart = 0;
    let newLinesCount = 0;
    const lines: string[] = [];

    let setStart = false;
    for (const op of slice) {
      if (!setStart) {
        oldStart = "oldIdx" in op ? op.oldIdx : 1;
        newStart = "newIdx" in op ? op.newIdx : 1;
        setStart = true;
      }

      if (op.type === "equal") {
        oldLinesCount++;
        newLinesCount++;
        lines.push(` ${op.line}`);
      } else if (op.type === "delete") {
        oldLinesCount++;
        lines.push(`-${op.line}`);
      } else if (op.type === "insert") {
        newLinesCount++;
        lines.push(`+${op.line}`);
      }
    }

    hunks.push({
      oldStart: oldStart || 1,
      oldLines: oldLinesCount,
      newStart: newStart || 1,
      newLines: newLinesCount,
      lines
    });
  }

  return hunks;
}
