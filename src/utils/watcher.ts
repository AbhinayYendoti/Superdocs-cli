import { watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function computeBufferHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
  const targetDir = path.dirname(absolutePath);
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
      watcher = fsWatch(absolutePath, () => {
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
