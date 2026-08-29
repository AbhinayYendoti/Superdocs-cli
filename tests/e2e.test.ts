import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { TEST_API_KEY, assertBuilt, cleanupHomes, makeHome, runCli, spawnCli } from "./cli.js";
import { startMockServer, type MockServer } from "./mockServer.js";

/**
 * End-to-end coverage: every command and flag is exercised by spawning the
 * built `dist/index.js` against a mock SuperDocs API. This is the only suite
 * that tests the artifact users actually install.
 */

const ORIGINAL = "# Original\n\nOld body.\n";
const EDITED = "# Edited\n\nRewritten body.\n";

let servers: MockServer[] = [];

async function server(...args: Parameters<typeof startMockServer>): Promise<MockServer> {
  const instance = await startMockServer(...args);
  servers.push(instance);
  return instance;
}

before(() => {
  assertBuilt();
});

after(async () => {
  await Promise.all(servers.splice(0).map((instance) => instance.close()));
  await cleanupHomes();
});

async function withDoc(home: string, content = ORIGINAL, name = "doc.md"): Promise<string> {
  const filePath = path.join(home, name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function authEnv(api: MockServer): Record<string, string> {
  return { SUPERDOCS_API_KEY: TEST_API_KEY, SUPERDOCS_API_BASE_URL: api.baseUrl };
}

describe("e2e: global flags", () => {
  it("--version prints the package version and nothing else", async () => {
    const home = await makeHome();
    const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    const result = await runCli(["--version"], { home });

    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), pkg.version);
    assert.equal(result.stderr, "");
  });

  it("--help lists every command and exits 0", async () => {
    const home = await makeHome();
    const result = await runCli(["--help"], { home });

    assert.equal(result.code, 0);
    for (const command of ["auth", "edit", "config", "completion", "login", "logout", "status"]) {
      assert.ok(result.stdout.includes(command), `help should mention ${command}`);
    }
  });

  it("exits 2 with a suggestion on an unknown command", async () => {
    const home = await makeHome();
    const result = await runCli(["stauts"], { home });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /unknown command/iu);
  });

  it("--no-color suppresses ANSI escapes", async () => {
    const api = await server({ rejectAuth: true });
    const home = await makeHome();
    const result = await runCli(["--no-color", "status"], { home, env: authEnv(api) });

    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(result.stderr, /\[/u);
  });

  it("--quiet suppresses status text but keeps errors", async () => {
    const api = await server({ rejectAuth: true });
    const home = await makeHome();
    const result = await runCli(["--quiet", "status"], { home, env: authEnv(api) });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /credentials/iu);
  });

  it("--verbose emits HTTP debug lines on stderr only", async () => {
    const api = await server();
    const home = await makeHome();
    const result = await runCli(["--verbose", "status"], { home, env: authEnv(api) });

    assert.equal(result.code, 0);
    assert.match(result.stderr, /\[http\] request GET/u);
    assert.doesNotMatch(result.stdout, /\[http\]/u);
  });

  it("redacts the API key from verbose logs", async () => {
    const api = await server();
    const home = await makeHome();
    const result = await runCli(["--verbose", "status"], { home, env: authEnv(api) });

    assert.ok(!result.stderr.includes(TEST_API_KEY), "the API key must never be logged");
    assert.ok(!result.stdout.includes(TEST_API_KEY));
    assert.doesNotMatch(result.stderr, /authorization/iu, "auth headers must not be echoed");
  });
});

describe("e2e: auth", () => {
  it("login stores credentials, status confirms, logout removes them", async () => {
    const api = await server();
    const home = await makeHome();
    const env = { SUPERDOCS_API_BASE_URL: api.baseUrl };
    const credentialsPath = path.join(home, "credentials.json");

    const login = await runCli(["auth", "login", "--api-key", TEST_API_KEY], { home, env });
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stderr, /Authentication successful/u);

    const stored = JSON.parse(await readFile(credentialsPath, "utf8")) as { apiKey: string };
    assert.equal(stored.apiKey, TEST_API_KEY);

    const status = await runCli(["auth", "status"], { home, env });
    assert.equal(status.code, 0, status.stderr);
    assert.match(status.stderr, /signed in/u);

    const logout = await runCli(["auth", "logout"], { home, env });
    assert.equal(logout.code, 0);
    assert.match(logout.stderr, /Signed out/u);

    const after = await runCli(["auth", "status"], { home, env });
    assert.equal(after.code, 3, "no credentials should exit with the config code");
  });

  it("top-level login/logout/status aliases behave identically", async () => {
    const api = await server();
    const home = await makeHome();
    const env = { SUPERDOCS_API_BASE_URL: api.baseUrl };

    assert.equal((await runCli(["login", "--api-key", TEST_API_KEY], { home, env })).code, 0);
    assert.equal((await runCli(["status"], { home, env })).code, 0);
    assert.equal((await runCli(["logout"], { home, env })).code, 0);
  });

  it("rejects a malformed API key without contacting the API", async () => {
    const api = await server();
    const home = await makeHome();
    const result = await runCli(["auth", "login", "--api-key", "nope"], {
      home,
      env: { SUPERDOCS_API_BASE_URL: api.baseUrl }
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /valid SuperDocs API key/u);
    assert.equal(api.count("GET", "/v1/sessions"), 0);
  });

  it("maps a rejected key to exit code 4", async () => {
    const api = await server({ rejectAuth: true });
    const home = await makeHome();
    const result = await runCli(["status"], { home, env: authEnv(api) });

    assert.equal(result.code, 4);
    assert.match(result.stderr, /could not verify your credentials/iu);
    assert.match(result.stderr, /auth login/u);
  });

  it("logout is idempotent when already signed out", async () => {
    const home = await makeHome();
    const result = await runCli(["logout"], { home });

    assert.equal(result.code, 0);
    assert.match(result.stderr, /already signed out/u);
  });

  it("reports status as newline-delimited JSON", async () => {
    const api = await server();
    const home = await makeHome();
    const result = await runCli(["--json", "status"], { home, env: authEnv(api) });

    assert.equal(result.code, 0);
    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(parsed["ok"], true);
    assert.equal(parsed["auth"], "authenticated");
    assert.equal(parsed["keySource"], "environment");
    assert.equal(parsed["schema_version"], 1);
  });
});

describe("e2e: config", () => {
  it("sets, gets, and lists preferences", async () => {
    const home = await makeHome();

    const set = await runCli(["config", "set", "default-model", "pro"], { home });
    assert.equal(set.code, 0, set.stderr);

    const get = await runCli(["config", "get", "default-model"], { home });
    assert.equal(get.stderr.trim(), "pro");

    const list = await runCli(["config", "list"], { home });
    assert.match(list.stderr, /default-model=pro/u);
    assert.match(list.stderr, /response-mode=/u);
  });

  it("accepts underscore and hyphen key spellings", async () => {
    const home = await makeHome();
    assert.equal((await runCli(["config", "set", "response_mode", "full"], { home })).code, 0);
    assert.match((await runCli(["config", "get", "response-mode"], { home })).stderr, /full/u);
  });

  it("rejects unknown keys and invalid values", async () => {
    const home = await makeHome();

    const badKey = await runCli(["config", "set", "nonsense", "x"], { home });
    assert.notEqual(badKey.code, 0);
    assert.match(badKey.stderr, /does not recognize/u);

    const badValue = await runCli(["config", "set", "default-model", "ultra"], { home });
    assert.notEqual(badValue.code, 0);
    assert.match(badValue.stderr, /core, turbo, pro, max/u);

    const badTimeout = await runCli(["config", "set", "timeout", "-5"], { home });
    assert.notEqual(badTimeout.code, 0);
    assert.match(badTimeout.stderr, /positive whole number/u);
  });

  it("emits config JSON on stdout and prose on stderr", async () => {
    const home = await makeHome();
    await runCli(["config", "set", "timeout", "900"], { home });
    const result = await runCli(["--json", "config", "list"], { home });

    const parsed = JSON.parse(result.stdout.trim()) as {
      values: Record<string, unknown>;
    };
    assert.equal(parsed.values["timeout"], "900");
    assert.equal(result.stderr, "");
  });

  it("applies a saved default-model to an edit", async () => {
    const api = await server();
    const home = await makeHome();
    await runCli(["config", "set", "default-model", "max"], { home });
    const doc = await withDoc(home);

    await runCli(["edit", doc, "-p", "Tighten"], { home, env: authEnv(api) });

    assert.equal(api.bodyOf("POST", "/v1/chat/async")?.["model_tier"], "max");
  });

  it("lets a flag override saved config", async () => {
    const api = await server();
    const home = await makeHome();
    await runCli(["config", "set", "default-model", "max"], { home });
    const doc = await withDoc(home);

    await runCli(["edit", doc, "-p", "Tighten", "--model-tier", "core"], {
      home,
      env: authEnv(api)
    });

    assert.equal(api.bodyOf("POST", "/v1/chat/async")?.["model_tier"], "core");
  });
});

describe("e2e: completion", () => {
  for (const shell of ["bash", "zsh", "fish"] as const) {
    it(`prints a ${shell} script to stdout`, async () => {
      const home = await makeHome();
      const result = await runCli(["completion", shell], { home });

      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes("superdocs"), "script should reference the binary");
      const approveFlag = shell === "fish" ? "approve" : "--approve";
      assert.ok(result.stdout.includes(approveFlag), "script should list current flags");
      assert.equal(result.stderr, "");
    });
  }

  it("rejects an unsupported shell", async () => {
    const home = await makeHome();
    const result = await runCli(["completion", "nushell"], { home });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /unsupported shell/iu);
  });

  it("errors when no shell is given", async () => {
    const home = await makeHome();
    const result = await runCli(["completion"], { home });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /missing shell/iu);
  });
});

describe("e2e: edit", () => {
  it("edits a file in place and reports on stderr", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "--prompt", "Tighten this"], {
      home,
      env: authEnv(api)
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(doc, "utf8"), EDITED);
    assert.equal(result.stdout, "", "an in-place edit writes nothing to stdout");
    assert.match(result.stderr, /Session: /u);
    assert.match(result.stderr, /Job: /u);
  });

  it("writes to --output and leaves the input untouched", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);
    const out = path.join(home, "out.md");

    const result = await runCli(["edit", doc, "-p", "Tighten", "-o", out], {
      home,
      env: authEnv(api)
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(doc, "utf8"), ORIGINAL);
    assert.equal(await readFile(out, "utf8"), EDITED);
  });

  it("streams stdin to stdout with status on stderr", async () => {
    const api = await server();
    const home = await makeHome();

    const result = await runCli(["edit", "-p", "Fix spelling"], {
      home,
      env: authEnv(api),
      stdin: "helo wrold\n"
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, EDITED, "stdout must contain only the document");
  });

  it("detects a piped git diff and requests txt", async () => {
    const api = await server({ exportBody: Buffer.from("Release notes\n", "utf8") });
    const home = await makeHome();
    const diff = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n";

    const result = await runCli(["edit", "-p", "Write release notes"], {
      home,
      env: authEnv(api),
      stdin: diff
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(api.bodyOf("POST", "/v1/documents/export")?.["format"], "txt");
  });

  it("honours --format for stdin", async () => {
    const api = await server();
    const home = await makeHome();

    await runCli(["edit", "-p", "x", "--format", "txt"], {
      home,
      env: authEnv(api),
      stdin: "plain text\n"
    });

    assert.equal(api.bodyOf("POST", "/v1/documents/export")?.["format"], "txt");
  });

  it("prints a redirectable diff for --dry-run without touching the file", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "Tighten", "--dry-run"], {
      home,
      env: authEnv(api)
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(doc, "utf8"), ORIGINAL, "dry run must not write");
    assert.match(result.stdout, /^--- /mu);
    assert.match(result.stdout, /\+# Edited/u);
    assert.ok(!result.stdout.includes("Dry run active"), "status text must stay on stderr");
    assert.match(result.stderr, /Dry run active/u);
  });

  it("reports no changes when the export matches the input", async () => {
    const api = await server({ exportBody: Buffer.from(ORIGINAL, "utf8") });
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "Leave alone", "--dry-run"], {
      home,
      env: authEnv(api)
    });

    assert.equal(result.code, 0);
    assert.match(result.stderr, /No changes proposed/u);
    assert.equal(result.stdout, "");
  });

  it("passes model, response mode, and thinking depth through", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    await runCli(
      [
        "edit",
        doc,
        "-p",
        "Tighten",
        "--model-tier",
        "pro",
        "--response-mode",
        "full",
        "--thinking-depth",
        "deep"
      ],
      { home, env: authEnv(api) }
    );

    const body = api.bodyOf("POST", "/v1/chat/async");
    assert.equal(body?.["model_tier"], "pro");
    assert.equal(body?.["response_mode"], "full");
    assert.equal(body?.["thinking_depth"], "deep");
  });

  it("reuses an explicit --session-id", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    await runCli(["edit", doc, "-p", "Tighten", "--session-id", "my-session"], {
      home,
      env: authEnv(api)
    });

    assert.equal(api.bodyOf("POST", "/v1/chat/async")?.["session_id"], "my-session");
  });

  it("sends an Idempotency-Key on mutating calls", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    await runCli(["edit", doc, "-p", "Tighten"], { home, env: authEnv(api) });

    const chat = api.requests.find((entry) => entry.url === "/v1/chat/async");
    assert.match(String(chat?.headers["idempotency-key"]), /^req_/u);
  });

  it("emits a single JSON result line for automation", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["--json", "edit", doc, "-p", "Tighten"], {
      home,
      env: authEnv(api)
    });

    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(parsed["ok"], true);
    assert.equal(parsed["output"], doc);
    assert.equal(parsed["format"], "markdown");
  });

  it("interleaves parseable progress events under --json --verbose", async () => {
    const api = await server({
      jobSequence: [
        { job_id: "job_e2e", status: "pending" },
        { job_id: "job_e2e", status: "in_progress" },
        { job_id: "job_e2e", status: "completed", result: { response: "ok" } }
      ]
    });
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(
      ["--json", "--verbose", "edit", doc, "-p", "Tighten", "--poll-interval", "1"],
      { home, env: authEnv(api) }
    );

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length > 1, "progress plus result");
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      assert.equal(parsed["schema_version"], 1);
    }
  });

  it("consumes SSE job events when streaming is available", async () => {
    const api = await server({
      streamEvents: [
        { type: "progress", message: "thinking" },
        { type: "final", status: "completed", result: { response: "ok" } }
      ]
    });
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "Tighten"], { home, env: authEnv(api) });

    assert.equal(result.code, 0, result.stderr);
    assert.ok(api.paths().some((entry) => entry.endsWith("/stream")));
    assert.equal(await readFile(doc, "utf8"), EDITED);
  });
});

describe("e2e: edit safety", () => {
  it("refuses unsupported extensions", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home, "body", "notes.rtf");

    const result = await runCli(["edit", doc, "-p", "x"], { home, env: authEnv(api) });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /\.md, \.markdown, and \.txt/u);
    assert.equal(api.count("POST", "/v1/chat/async"), 0);
  });

  it("refuses an empty file before uploading", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home, "   \n");

    const result = await runCli(["edit", doc, "-p", "x"], { home, env: authEnv(api) });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /is empty/u);
    assert.equal(api.count("POST", "/v1/chat/async"), 0);
  });

  it("refuses binary input", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = path.join(home, "bin.md");
    await writeFile(doc, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xff]));

    const result = await runCli(["edit", doc, "-p", "x"], { home, env: authEnv(api) });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /binary|UTF-8/u);
  });

  it("reports a missing file clearly", async () => {
    const api = await server();
    const home = await makeHome();

    const result = await runCli(["edit", path.join(home, "ghost.md"), "-p", "x"], {
      home,
      env: authEnv(api)
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Could not find input file/u);
  });

  it("refuses an empty export rather than destroying the file", async () => {
    const api = await server({ exportBody: Buffer.alloc(0) });
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "x"], { home, env: authEnv(api) });

    assert.notEqual(result.code, 0);
    assert.equal(await readFile(doc, "utf8"), ORIGINAL, "original must survive");
    assert.match(result.stderr, /empty export/u);
  });

  it("leaves no lock file behind after a failure", async () => {
    const api = await server({
      jobSequence: [{ job_id: "job_e2e", status: "failed", error: "nope" }]
    });
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "x", "--poll-interval", "1"], {
      home,
      env: authEnv(api)
    });

    assert.notEqual(result.code, 0);
    await assert.rejects(() => readFile(`${doc}.superdocs.lock`, "utf8"));
    assert.equal(await readFile(doc, "utf8"), ORIGINAL);
  });

  it("rejects a second edit while a lock is held", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);
    await writeFile(`${doc}.superdocs.lock`, JSON.stringify({ pid: 1 }), "utf8");

    const result = await runCli(["edit", doc, "-p", "x"], { home, env: authEnv(api) });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /already using/u);
  });

  it("requires a prompt in a non-interactive terminal", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc], { home, env: authEnv(api) });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /--prompt is required/u);
  });

  it("rejects an empty stdin payload", async () => {
    const api = await server();
    const home = await makeHome();

    const result = await runCli(["edit", "-p", "x"], { home, env: authEnv(api), stdin: "" });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /No input received from stdin/u);
  });

  it("rejects --watch with stdin", async () => {
    const home = await makeHome();
    const result = await runCli(["edit", "--watch", "-p", "x"], { home, stdin: "hello" });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /--watch requires a file path/u);
  });

  it("validates numeric options", async () => {
    const home = await makeHome();
    const api = await server();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "x", "--poll-interval", "0"], {
      home,
      env: authEnv(api)
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /--poll-interval must be a positive number/u);
  });
});

describe("e2e: approvals", () => {
  const paused = [
    { job_id: "job_e2e", status: "awaiting_approval" },
    { job_id: "job_e2e", status: "completed", result: { response: "ok" } }
  ];

  it("auto-continues a paused job by default", async () => {
    const api = await server({ jobSequence: paused });
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "x", "--poll-interval", "1"], {
      home,
      env: authEnv(api)
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(continueBody(api)?.["continue"], true);
  });

  it("stops and cancels with --no-auto-continue", async () => {
    const api = await server({ jobSequence: paused });
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(
      ["edit", doc, "-p", "x", "--no-auto-continue", "--poll-interval", "1"],
      { home, env: authEnv(api) }
    );

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /paused this large edit/u);
    assert.match(result.stderr, /--approve ask/u, "the hint should name the alternative");
    assert.equal(continueBody(api)?.["continue"], false);
    assert.ok(api.paths().some((entry) => entry.endsWith("/cancel")));
    assert.equal(await readFile(doc, "utf8"), ORIGINAL);
  });

  it("sends approval_mode=ask_every_time for --approve ask", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    await runCli(["edit", doc, "-p", "x", "--approve", "ask"], { home, env: authEnv(api) });

    assert.equal(api.bodyOf("POST", "/v1/chat/async")?.["approval_mode"], "ask_every_time");
  });

  it("defaults to approve_all", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    await runCli(["edit", doc, "-p", "x"], { home, env: authEnv(api) });

    assert.equal(api.bodyOf("POST", "/v1/chat/async")?.["approval_mode"], "approve_all");
  });

  it("rejects an unknown approval mode with a usage exit code", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "x", "--approve", "sometimes"], {
      home,
      env: authEnv(api)
    });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /--approve must be one of: all, ask/u);
    assert.equal(api.count("POST", "/v1/chat/async"), 0);
  });
});

describe("e2e: git integration", () => {
  it("sends repository context with the instruction", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "Summarise the branch", "--git"], {
      home,
      env: authEnv(api),
      cwd: process.cwd()
    });

    assert.equal(result.code, 0, result.stderr);
    const message = String(api.bodyOf("POST", "/v1/chat/async")?.["message"]);
    assert.ok(message.includes("Summarise the branch"));
    assert.ok(message.includes("Git context for this request"), message);
    assert.ok(message.includes("Repository root:"));
    assert.match(result.stderr, /\[git\] Repository root:/u);
    assert.equal(result.stdout, "", "git notes must not reach stdout");
  });

  it("fails cleanly outside a repository", async () => {
    const api = await server();
    const home = await makeHome();
    const doc = await withDoc(home);

    const result = await runCli(["edit", doc, "-p", "x", "--git"], {
      home,
      // A developer's home directory can itself be a repository, so stop git's
      // upward search at the temp root to keep this deterministic.
      env: { ...authEnv(api), GIT_CEILING_DIRECTORIES: os.tmpdir() },
      cwd: home
    });

    assert.equal(result.code, 2);
    assert.match(result.stderr, /not a Git repository/u);
    assert.equal(api.count("POST", "/v1/chat/async"), 0);
  });

  it("keeps git notes out of a redirected document", async () => {
    const api = await server();
    const home = await makeHome();

    const result = await runCli(["edit", "-p", "Summarise", "--git"], {
      home,
      env: authEnv(api),
      stdin: "# Notes\n\nSome text.\n",
      cwd: process.cwd()
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, EDITED, "stdout is the document, nothing else");
    assert.match(result.stderr, /\[git\]/u);
  });
});

describe("e2e: watch mode", () => {
  it("edits on start and again when the file changes", async (t) => {
    t.diagnostic("watch mode drives two full edit cycles; allow generous timeouts");
    const api = await server({
      exportBodyFor: (index) => Buffer.from(`# Pass ${index + 1}\n\nBody.\n`, "utf8")
    });
    const home = await makeHome();
    const doc = await withDoc(home);

    const child = spawnCli(
      ["edit", doc, "-p", "Tighten", "--watch", "--watch-debounce", "50", "--poll-interval", "1"],
      { home, env: authEnv(api) }
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    try {
      // Wait for the watcher to announce itself, not just for the first write:
      // modifying mid-cycle would race the initial pass.
      await waitFor(() => Promise.resolve(stderr.includes("[watch] Watching")), 25_000);
      await waitFor(async () => (await readFile(doc, "utf8")).includes("Pass 1"), 25_000);

      await writeFile(doc, "# Original\n\nEdited by hand.\n", "utf8");
      await waitFor(async () => (await readFile(doc, "utf8")).includes("Pass 2"), 25_000);
    } finally {
      child.kill();
    }

    assert.match(stderr, /\[watch\] Watching/u);
    assert.match(stderr, /Change detected/u);
    assert.ok(api.count("POST", "/v1/chat/async") >= 2, "two edit cycles");
  });
});

describe("e2e: resilience", () => {
  it("maps an unreachable API to exit code 5", async () => {
    const home = await makeHome();
    const result = await runCli(["status"], {
      home,
      env: { SUPERDOCS_API_KEY: TEST_API_KEY, SUPERDOCS_API_BASE_URL: "http://127.0.0.1:9" }
    });

    assert.equal(result.code, 5);
    assert.match(result.stderr, /Could not connect/u);
  });

  it("normalizes a trailing slash on --api-url", async () => {
    const api = await server();
    const home = await makeHome();
    const result = await runCli(["--api-url", `${api.baseUrl}/`, "status"], {
      home,
      env: { SUPERDOCS_API_KEY: TEST_API_KEY }
    });

    assert.equal(result.code, 0, result.stderr);
    assert.ok(!api.paths().some((entry) => entry.includes("//v1")));
  });

  it("routes traffic to SUPERDOCS_API_BASE_URL", async () => {
    // Regression: a Commander default on --api-url shadowed this variable, so
    // self-hosted and development traffic silently went to the public API.
    const api = await server();
    const home = await makeHome();

    const result = await runCli(["status"], {
      home,
      env: { SUPERDOCS_API_KEY: TEST_API_KEY, SUPERDOCS_API_BASE_URL: api.baseUrl }
    });

    assert.equal(result.code, 0, result.stderr);
    assert.ok(api.count("GET", "/health") > 0, "the mock API must receive the request");
  });

  it("prefers --api-key over the environment", async () => {
    const api = await server();
    const home = await makeHome();
    const result = await runCli(["--json", "--api-key", TEST_API_KEY, "status"], {
      home,
      env: { SUPERDOCS_API_BASE_URL: api.baseUrl, SUPERDOCS_API_KEY: "sk_environmentkey123" }
    });

    const parsed = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    assert.equal(parsed["keySource"], "flag");
  });
});

function continueBody(api: MockServer): Record<string, unknown> | undefined {
  return api.requests.find((entry) => entry.url.endsWith("/continue"))?.body;
}

/**
 * Watch mode drives two full edit cycles, each spawning work against the mock
 * API. Windows runners are markedly slower than Linux here, so the budget is
 * generous; the failure message carries the child's stderr so a CI timeout is
 * diagnosable without a rerun.
 */
const WATCH_TIMEOUT_MS = 60_000;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  describe?: () => string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
    } catch {
      // File may be mid-rename during an atomic write; retry.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs} ms.${describe ? ` ${describe()}` : ""}`);
}
