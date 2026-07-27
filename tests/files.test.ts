import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquireFileLock,
  createEditableFileFromBuffer,
  createSessionId,
  readEditableFile,
  validateExportedTextBytes,
  writeFileAtomically
} from "../src/utils/files.js";
import { processCleanup } from "../src/utils/cleanup.js";

describe("files", () => {
  it("rejects empty files before upload", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      const filePath = path.join(tempDir, "empty.md");
      await writeFile(filePath, "\n", "utf8");
      await assert.rejects(() => readEditableFile(filePath), /Input file is empty/u);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid UTF-8 files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      const filePath = path.join(tempDir, "invalid.txt");
      await writeFile(filePath, Buffer.from([0xff, 0xfe, 0xfd]));
      await assert.rejects(() => readEditableFile(filePath), /not valid UTF-8/u);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects binary-looking text files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      const filePath = path.join(tempDir, "binary.txt");
      await writeFile(filePath, Buffer.from([0, 65, 66, 67]));
      await assert.rejects(() => readEditableFile(filePath), /binary data/u);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts forward-slash paths on Windows-style shells", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      await mkdir(path.join(tempDir, "nested"));
      const filePath = path.join(tempDir, "nested", "note.md");
      await writeFile(filePath, "Hello world", "utf8");
      const slashPath = filePath.replace(/\\/gu, "/");
      const editable = await readEditableFile(slashPath);
      assert.equal(editable.filename, "note.md");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps Linux-style session ids stable and shell-safe", () => {
    assert.match(createSessionId("/home/dev/docs/My Proposal.md"), /^cli-my-proposal-[a-z0-9]+$/u);
  });

  it("locks concurrent writes to the same output path", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      const filePath = path.join(tempDir, "locked.md");
      await writeFile(filePath, "Hello", "utf8");
      const lock = await acquireFileLock(filePath);
      try {
        await assert.rejects(() => acquireFileLock(filePath), /already using/u);
      } finally {
        await lock.release();
      }
      await acquireFileLock(filePath).then((nextLock) => nextLock.release());
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("removes stale locks", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      const filePath = path.join(tempDir, "stale.md");
      const lockPath = `${filePath}.superdocs.lock`;
      await writeFile(filePath, "Hello", "utf8");
      await writeFile(lockPath, "stale", "utf8");
      const stale = new Date(Date.now() - 7 * 60 * 60 * 1000);
      await utimes(lockPath, stale, stale);
      const lock = await acquireFileLock(filePath);
      await lock.release();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("releases registered locks during process cleanup", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      const filePath = path.join(tempDir, "cleanup.md");
      await writeFile(filePath, "Hello", "utf8");
      const lock = await acquireFileLock(filePath);
      const unregister = processCleanup.register(() => lock.release());

      try {
        await processCleanup.runCleanup();
        await acquireFileLock(filePath).then((nextLock) => nextLock.release());
      } finally {
        unregister();
        await lock.release();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not leave temp files after failed atomic writes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "superdocs-files-"));
    try {
      const missingDirFile = path.join(tempDir, "missing", "out.md");
      await assert.rejects(() => writeFileAtomically(missingDirFile, Buffer.from("text")));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects empty, invalid, or binary exports before overwrite", () => {
    assert.throws(
      () => validateExportedTextBytes(new Uint8Array(), Buffer.from("original")),
      /empty export/u
    );
    assert.throws(
      () => validateExportedTextBytes(Buffer.from([0xff]), Buffer.from("original")),
      /not valid UTF-8/u
    );
    assert.throws(
      () => validateExportedTextBytes(Buffer.from([0, 65, 66]), Buffer.from("original")),
      /binary data/u
    );
  });

  it("validates stdin buffers like files", () => {
    assert.throws(() => createEditableFileFromBuffer(Buffer.from("")), /stdin is empty/u);
    assert.equal(createEditableFileFromBuffer(Buffer.from("Hello"), "txt").filename, "stdin.txt");
  });
});
