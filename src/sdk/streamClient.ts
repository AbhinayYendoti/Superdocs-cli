import type { IStreamClient } from "./interfaces.js";
import { sleep } from "../utils/sleep.js";
import { redactSecrets } from "../utils/redact.js";

export interface JobEvent {
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface SseFrame {
  eventName: string;
  data: string;
  id?: string | undefined;
  retryMs?: number | undefined;
}

export interface StreamJobEventsOptions {
  baseUrl: string;
  apiKey: string;
  jobId: string;
  sessionId?: string | undefined;
  lastSequence?: number | undefined;
  maxReconnects?: number | undefined;
  reconnectDelayMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onEvent?: ((event: JobEvent) => void) | undefined;
  onReconnect?: ((attempt: number, lastSequence: number) => void) | undefined;
}

export class StreamClient implements IStreamClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly debug: ((message: string) => void) | undefined;

  constructor(options: { baseUrl: string; apiKey: string; debug?: (message: string) => void }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, "");
    this.apiKey = options.apiKey;
    this.debug = options.debug;
  }

  async *streamJobEvents(
    jobId: string,
    options: Omit<StreamJobEventsOptions, "baseUrl" | "apiKey" | "jobId"> = {}
  ): AsyncGenerator<JobEvent, void, unknown> {
    const maxReconnects = options.maxReconnects ?? 5;
    let reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    let lastSequence = options.lastSequence ?? 0;
    let reconnectAttempts = 0;

    if (!options.sessionId) {
      throw new Error("SuperDocs SSE streaming requires a session ID; use job polling instead.");
    }

    while (reconnectAttempts <= maxReconnects) {
      if (options.signal?.aborted) {
        return;
      }

      try {
        const url = new URL(
          `${this.baseUrl}/v1/chat/${encodeURIComponent(options.sessionId)}/stream`
        );
        url.searchParams.set("job_id", jobId);
        if (lastSequence > 0) {
          url.searchParams.set("last_sequence", String(lastSequence));
        }

        const fetchInit: RequestInit = {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            Authorization: `Bearer ${this.apiKey}`,
            "Cache-Control": "no-cache"
          },
          ...(options.signal ? { signal: options.signal } : {})
        };

        this.debugLog(`[http] request GET ${url.toString()}`);
        const response = await fetch(url.toString(), fetchInit);
        this.debugLog(
          `[http] response GET ${url.toString()} -> ${response.status} ${response.statusText}`
        );
        this.debugLog(
          `[http] response headers:\n${JSON.stringify(headersToObject(response.headers), null, 2)}`
        );

        if (!response.ok) {
          throw new Error(`SSE request failed with status ${response.status}`);
        }

        if (!response.body) {
          throw new Error("Response body is missing");
        }

        reconnectAttempts = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        const parser = new SseParser();
        let sawTerminalEvent = false;

        while (true) {
          if (options.signal?.aborted) {
            void reader.cancel();
            return;
          }

          const { done, value } = await reader.read();
          const frames = done
            ? parser.close(decoder.decode())
            : parser.push(decoder.decode(value, { stream: true }));

          for (const frame of frames) {
            if (frame.retryMs !== undefined) {
              reconnectDelayMs = frame.retryMs;
            }

            if (!frame.data) {
              continue;
            }

            this.debugLog(`[sse] event ${frame.eventName}\n${frame.data}`);

            const parsedData = parseEventData(frame.data);
            const sequence = resolveSequence(frame.id, lastSequence);

            if (sequence > lastSequence) {
              lastSequence = sequence;
            }

            const jobEvent: JobEvent = {
              sequence,
              type: normalizeEventType(frame.eventName, parsedData),
              data: parsedData,
              timestamp: (parsedData["timestamp"] as string) || new Date().toISOString()
            };

            options.onEvent?.(jobEvent);
            yield jobEvent;

            if (isTerminalEvent(jobEvent)) {
              sawTerminalEvent = true;
              return;
            }
          }

          if (done) {
            break;
          }
        }

        if (sawTerminalEvent) {
          return;
        }

        throw new Error("SSE connection closed before a terminal event.");
      } catch (err) {
        if (options.signal?.aborted) {
          return;
        }

        const isUnsupported = err instanceof Error && err.message.includes("404");
        if (isUnsupported) {
          throw err;
        }

        reconnectAttempts++;
        if (reconnectAttempts > maxReconnects) {
          throw err;
        }

        options.onReconnect?.(reconnectAttempts, lastSequence);
        const delay = reconnectDelayMs * 2 ** (reconnectAttempts - 1);
        await sleep(delay);
      }
    }
  }

  private debugLog(message: string): void {
    this.debug?.(redactSecrets(message));
  }
}

class SseParser {
  private buffer = "";
  private eventName = "message";
  private dataLines: string[] = [];
  private id: string | undefined;
  private retryMs: number | undefined;

  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];

    while (true) {
      const lineEnd = findLineEnd(this.buffer);
      if (!lineEnd) {
        return frames;
      }

      const line = this.buffer.slice(0, lineEnd.index);
      this.buffer = this.buffer.slice(lineEnd.nextIndex);
      const frame = this.processLine(line);
      if (frame) {
        frames.push(frame);
      }
    }
  }

  close(chunk = ""): SseFrame[] {
    const frames = this.push(chunk);
    if (this.buffer.length > 0) {
      const frame = this.processLine(this.buffer);
      this.buffer = "";
      if (frame) {
        frames.push(frame);
      }
    }

    const finalFrame = this.dispatch();
    if (finalFrame) {
      frames.push(finalFrame);
    }

    return frames;
  }

  private processLine(line: string): SseFrame | undefined {
    if (line === "") {
      return this.dispatch();
    }

    if (line.startsWith(":")) {
      return undefined;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      this.eventName = value || "message";
    } else if (field === "data") {
      this.dataLines.push(value);
    } else if (field === "id" && !value.includes("\0")) {
      this.id = value;
    } else if (field === "retry") {
      const retry = Number.parseInt(value, 10);
      if (Number.isFinite(retry) && retry >= 0) {
        this.retryMs = retry;
      }
    }

    return undefined;
  }

  private dispatch(): SseFrame | undefined {
    if (this.dataLines.length === 0 && this.retryMs === undefined && this.id === undefined) {
      this.eventName = "message";
      return undefined;
    }

    const frame: SseFrame = {
      eventName: this.eventName,
      data: this.dataLines.join("\n"),
      ...(this.id !== undefined ? { id: this.id } : {}),
      ...(this.retryMs !== undefined ? { retryMs: this.retryMs } : {})
    };

    this.eventName = "message";
    this.dataLines = [];
    this.id = undefined;
    this.retryMs = undefined;
    return frame;
  }
}

function parseEventData(dataStr: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(dataStr) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return { message: dataStr };
  } catch {
    return { message: dataStr };
  }
}

function normalizeEventType(eventName: string, data: Record<string, unknown>): string {
  const dataType = data["type"];
  return eventName !== "message" ? eventName : typeof dataType === "string" ? dataType : "message";
}

function resolveSequence(id: string | undefined, lastSequence: number): number {
  const parsed = id ? Number.parseInt(id, 10) : lastSequence + 1;
  return Number.isFinite(parsed) ? parsed : lastSequence + 1;
}

function isTerminalEvent(event: JobEvent): boolean {
  const status = event.data["status"];
  return (
    event.type === "final" ||
    event.type === "complete" ||
    event.type === "error" ||
    event.type === "failed" ||
    status === "completed" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function findLineEnd(value: string): { index: number; nextIndex: number } | undefined {
  const lfIndex = value.indexOf("\n");
  const crIndex = value.indexOf("\r");

  if (lfIndex === -1 && crIndex === -1) {
    return undefined;
  }

  if (crIndex !== -1 && (lfIndex === -1 || crIndex < lfIndex)) {
    return {
      index: crIndex,
      nextIndex: value[crIndex + 1] === "\n" ? crIndex + 2 : crIndex + 1
    };
  }

  return {
    index: lfIndex,
    nextIndex: lfIndex + 1
  };
}

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}
