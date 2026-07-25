import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExportFormat } from "../types/api.js";

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const STALE_LOCK_MS = 6 * 60 * 60 * 1000;
const textDecoder = new TextDecoder("utf-8", { fatal: true });

export interface EditableFile {
  absolutePath: string;
  filename: string;
  extension: string;
  contentType: string;
  exportFormat: ExportFormat;
  bytes: Buffer;
  sizeBytes: number;
}

export async function readEditableFile(filePath: string): Promise<EditableFile> {
  const absolutePath = path.resolve(filePath);
  const extension = path.extname(absolutePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error("Only .md, .markdown, and .txt files are supported by `superdocs edit`.");
  }

  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Input path is not a file: ${absolutePath}`);
  }

  const bytes = await fs.readFile(absolutePath);
  validateTextBytes(bytes, "Input file");
  const isMarkdown = extension === ".md" || extension === ".markdown";

  return {
    absolutePath,
    filename: path.basename(absolutePath),
    extension,
    contentType: isMarkdown ? "text/markdown" : "text/plain",
    exportFormat: isMarkdown ? "markdown" : "txt",
    bytes,
    sizeBytes: bytes.byteLength
  };
}

export async function writeFileAtomically(filePath: string, bytes: Uint8Array): Promise<void> {
  const absolutePath = path.resolve(filePath);
  const directory = path.dirname(absolutePath);
  const tempPath = path.join(directory, `.${path.basename(absolutePath)}.${randomUUID()}.tmp`);
  const mode = await existingFileMode(absolutePath);

  try {
    await fs.writeFile(tempPath, bytes, { mode });
    await fs.rename(tempPath, absolutePath);
    await fs.chmod(absolutePath, mode).catch(() => {});
  } catch (err) {
    // Clean up temporary file if write or rename fails
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

async function existingFileMode(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).mode & 0o777;
  } catch (error) {
    if (isNotFoundError(error)) {
      return 0o600;
    }

    throw error;
  }
}

export interface FileLock {
  lockPath: string;
  release(): Promise<void>;
}

export async function acquireFileLock(filePath: string): Promise<FileLock> {
  const absolutePath = path.resolve(filePath);
  const lockPath = `${absolutePath}.superdocs.lock`;

  await removeStaleLock(lockPath);

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(lockPath, "wx");
    await handle.writeFile(
      JSON.stringify(
        {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          file: absolutePath
        },
        null,
        2
      )
    );
  } catch (error) {
    await handle?.close().catch(() => {});
    if (isFileExistsError(error)) {
      throw new Error(
        `Another SuperDocs edit is already using '${absolutePath}'. Wait for it to finish, or remove '${lockPath}' if no edit is running.`
      );
    }
    throw error;
  }

  let released = false;
  return {
    lockPath,
    async release(): Promise<void> {
      if (released) {
        return;
      }
      released = true;
      await handle?.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
    }
  };
}

export function createSessionId(filePath: string): string {
  const base = path
    .basename(filePath, path.extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `cli-${base || "document"}-${Date.now().toString(36)}`;
}

export async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

export function createEditableFileFromBuffer(
  bytes: Buffer,
  format: ExportFormat = "markdown"
): EditableFile {
  validateTextBytes(bytes, "stdin");
  const isMarkdown = format === "markdown";
  const extension = isMarkdown ? ".md" : ".txt";
  const filename = `stdin${extension}`;
  return {
    absolutePath: filename,
    filename,
    extension,
    contentType: isMarkdown ? "text/markdown" : "text/plain",
    exportFormat: format,
    bytes,
    sizeBytes: bytes.byteLength
  };
}

export function validateExportedTextBytes(bytes: Uint8Array, originalBytes: Uint8Array): void {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength === 0 && originalBytes.byteLength > 0) {
    throw new Error("SuperDocs returned an empty export. The original file was not overwritten.");
  }

  validateTextBytes(buffer, "SuperDocs export");
}

export function validateTextBytes(bytes: Buffer, label: string): void {
  let text: string;

  try {
    text = textDecoder.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8 text.`);
  }

  if (text.trim().length === 0) {
    throw new Error(`${label} is empty.`);
  }

  if (looksBinary(text)) {
    throw new Error(
      `${label} appears to be binary data. SuperDocs edit supports UTF-8 markdown and text files.`
    );
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const stats = await fs.stat(lockPath);
    if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
      await fs.unlink(lockPath);
    }
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function looksBinary(text: string): boolean {
  let controlCount = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code === 0) {
      return true;
    }
    if (code < 32 && code !== 9 && code !== 10 && code !== 12 && code !== 13) {
      controlCount += 1;
    }
  }

  return text.length > 0 && controlCount / text.length > 0.05;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isFileExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}
