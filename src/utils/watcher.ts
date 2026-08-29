import { watch as fsWatch, realpathSync, type FSWatcher } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function computeBufferHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Expands 8.3 short path components ("RUNNER~1") to their real long form.
 *
 * libuv's Windows fs-event backend compares the filename the OS reports against
 * the directory string it was handed:
 *
 *   Assertion failed: !_wcsnicmp(filename, dir, dirlen), src\win\fs-event.c:72
 *
 * Hand it a short path and the OS reports long names, the comparison fails, and
 * libuv *aborts the process* -- exit code 0xC0000409, not a catchable error. Any
 * Windows account whose profile name exceeds eight characters can produce such a
 * path, so `--watch` could hard-crash rather than report a problem.
 *
 * Falls back to the input when the path cannot be resolved; the caller's own
 * error handling covers a genuinely missing directory.
 */
export function resolveRealPath(targetPath: string): string {
  try {
    return realpathSync.native(targetPath);
  } catch {
    return targetPath;
  }
}

export interface WatchFileOptions {
  filePath: string;
  debounceMs?: number;
  onChange: () => Promise<void> | void;
  onError?: (error: unknown) => void;
}

export interface FileWatcher {
  close: () => void;
}

export function watchFile(options: WatchFileOptions): FileWatcher {
  const absolutePath = path.resolve(options.filePath);
  const targetBasename = path.basename(absolutePath);
  // Must be the real long path: a short 8.3 directory makes libuv abort.
  const targetDir = resolveRealPath(path.dirname(absolutePath));
  const debounceMs = options.debounceMs ?? 300;

  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let watcher: FSWatcher | null = null;

  const triggerChange = () => {
    if (closed) return;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      if (closed) return;
      void (async () => {
        try {
          await options.onChange();
        } catch (err) {
          options.onError?.(err);
        }
      })();
    }, debounceMs);
  };

  try {
    // Watch target directory to catch both `change` and `rename`/atomic replace events
    watcher = fsWatch(targetDir, (_eventType, filename) => {
      if (!filename) {
        triggerChange();
        return;
      }
      if (path.basename(filename) === targetBasename) {
        triggerChange();
      }
    });
  } catch {
    // Fallback: watch the file path directly if directory watching fails
    try {
      watcher = fsWatch(resolveRealPath(absolutePath), () => {
        triggerChange();
      });
    } catch (fallbackErr) {
      options.onError?.(fallbackErr);
    }
  }

  return {
    close: () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    }
  };
}
