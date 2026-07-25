export interface ProfileMetrics {
  startupTimeMs: number;
  memoryUsageMb: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  apiLatencyMs?: number;
  fileIoMs?: number;
}

const startTime = process.hrtime.bigint();

export function getStartupTimeMs(): number {
  const diff = process.hrtime.bigint() - startTime;
  return Number(diff) / 1_000_000;
}

export function getMemoryMetrics(): ProfileMetrics["memoryUsageMb"] {
  const mem = process.memoryUsage();
  return {
    rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100
  };
}

export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  const durationMs = Number(end - start) / 1_000_000;
  return { result, durationMs };
}
