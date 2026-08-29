import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "../src/utils/logger.js";

interface Captured {
  stdout: string;
  stderr: string;
}

function capture(run: () => void): Captured {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stderr.write;

  try {
    run();
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }

  return { stdout, stderr };
}

describe("Logger stream discipline", () => {
  it("sends status, warnings, and errors to stderr only", () => {
    const logger = new Logger({ color: false });
    const { stdout, stderr } = capture(() => {
      logger.info("working");
      logger.success("done");
      logger.warn("careful");
      logger.error("broke", "try this");
    });

    assert.equal(stdout, "", "human status text must never reach stdout");
    assert.ok(stderr.includes("working"));
    assert.ok(stderr.includes("done"));
    assert.ok(stderr.includes("careful"));
    assert.ok(stderr.includes("broke"));
    assert.ok(stderr.includes("try this"));
  });

  it("sends payload output to stdout only", () => {
    const logger = new Logger();
    const { stdout, stderr } = capture(() => {
      logger.output("# document\n");
    });

    assert.equal(stdout, "# document\n");
    assert.equal(stderr, "");
  });

  it("suppresses status text when quiet", () => {
    const logger = new Logger({ quiet: true });
    const { stderr } = capture(() => {
      logger.info("working");
      logger.warn("careful");
    });

    assert.equal(stderr, "");
  });
});

describe("Logger JSON output", () => {
  it("emits newline-delimited JSON that parses line by line", () => {
    const logger = new Logger({ json: true, verbose: true });
    const spinner = logger.spinner("x");

    const { stdout } = capture(() => {
      logger.progress(spinner, "uploading");
      logger.progress(spinner, "editing");
      logger.writeJson({ ok: true, output: "out.md" });
    });

    const lines = stdout.split("\n").filter((line) => line.length > 0);
    assert.equal(lines.length, 3, "one object per line");

    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(parsed[0]?.["message"], "uploading");
    assert.equal(parsed[1]?.["message"], "editing");
    assert.equal(parsed[2]?.["ok"], true);
    assert.equal(parsed[2]?.["output"], "out.md");
  });

  it("stamps a schema version on every object", () => {
    const logger = new Logger({ json: true });
    const { stdout } = capture(() => {
      logger.writeJson({ ok: true });
    });

    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(parsed["schema_version"], 1);
  });

  it("routes errors into the JSON stream rather than stderr", () => {
    const logger = new Logger({ json: true });
    const { stdout, stderr } = capture(() => {
      logger.error("nope", "do this");
    });

    assert.equal(stderr, "");
    const parsed = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(parsed["ok"], false);
    assert.equal(parsed["error"], "nope");
    assert.equal(parsed["hint"], "do this");
  });

  it("keeps human status text out of the JSON stream", () => {
    const logger = new Logger({ json: true });
    const { stdout, stderr } = capture(() => {
      logger.info("chatty");
      logger.success("also chatty");
    });

    assert.equal(stdout, "");
    assert.equal(stderr, "");
  });
});
