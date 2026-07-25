# Design

This document explains the shape of `superdocs-app-cli`: not just what exists, but why it exists this way.

The goal is simple: a developer should be able to send markdown, text, stdin, or a Git diff to SuperDocs from a terminal, get a useful edit back, and trust that the CLI will not damage local files or leak credentials.

## Architecture

```text
                User
                  |
                  v
        Commander Commands
                  |
                  v
          Edit Orchestration
                  |
        +---------+---------+
        |                   |
   File Service       SuperDocs SDK
        |                   |
        |         +---------+---------+
        |         |                   |
        |   Upload Service       Chat/Job Service
        |         |                   |
        +---------+---------+---------+
                            |
                       REST Client
                            |
                            v
                    api.superdocs.app
```

The command layer is intentionally thin. It parses flags, resolves configuration, and gives helpful terminal output. The SDK owns HTTP semantics, retries, auth headers, API schemas, streaming, and export behavior. File safety stays in the file utilities and service layer.

## Why Build An SDK Inside The CLI?

The CLI needs a real client boundary anyway. It has to call health checks, upload documents, start chat jobs, poll or stream job status, continue paused jobs, cancel jobs, and export documents.

Putting those calls behind `SuperDocsClient` gives us:

- one place for auth headers, idempotency keys, retries, timeouts, and redaction
- clean tests without shelling out to the CLI
- a future public SDK export without a rewrite
- less coupling between Commander commands and API response shapes

The tradeoff is a little more structure than a single `fetch()` helper. That cost is worth it because upload, job, and export flows are already multi-step and failure-prone.

## Why REST Instead Of MCP?

REST is the right default for this CLI because the CLI is a distribution artifact for developers, not an agent-only integration.

REST gives us:

- no local MCP server setup
- works in CI, SSH sessions, shells, and npm-installed environments
- simple auth through bearer tokens
- predictable behavior for stdin/stdout workflows
- easier debugging with request IDs and HTTP status codes

MCP could be valuable later for editor/agent integrations, but making this CLI depend on MCP would add setup friction for the core terminal use case.

## Why Async By Default?

Document edits can be slow. Uploading, model work, approvals, and export can all outlive a normal request timeout. The CLI therefore starts an async job, watches progress through SSE when available, and falls back to polling.

This avoids:

- hanging a single long HTTP request
- losing progress when streaming is unavailable
- making large edits depend on one fragile connection
- forcing users to guess whether work is still happening

The tradeoff is more orchestration code: jobs need status handling, cancellation, timeout behavior, and export after completion. That complexity is contained in `JobRunner` and the SDK.

## Why File Locking?

Two concurrent edits writing to the same file can silently clobber each other. That is unacceptable for a tool that edits source-controlled documents.

The CLI creates a short-lived `.superdocs.lock` next to the output file before remote work starts. If another edit is already targeting the same path, the second command fails clearly.

The lock also handles stale files: old locks are removed after a conservative timeout. The tradeoff is a small extra file during an edit, but the benefit is preventing invisible data loss.

## Why Atomic Writes?

Networked AI edits have many failure points. A process can crash after export, the OS can interrupt a write, or an editor can observe a half-written file.

The CLI writes to a temporary file in the destination directory, then renames it into place. On normal filesystems this means the final replacement is atomic.

We also preserve existing file permissions when replacing a file, and default new output files to owner-only permissions. The tradeoff is a little more I/O, but the result is much safer.

## Why Idempotency?

The SDK sends `Idempotency-Key` on mutating API calls. Retries are necessary for rate limits, transient network failures, and server errors, but retries should not accidentally create duplicate work.

Idempotency lets the server deduplicate repeated attempts for the same logical request. The tradeoff is that each request needs a generated key, but the API client can handle that automatically.

## Why `response_mode=compact`?

The CLI edits files. Its primary output is the edited document or a diff, not a long assistant explanation.

`compact` keeps remote responses focused and reduces payload size while preserving enough status information for the user. It also makes stdout workflows cleaner, especially when piping through scripts.

Users can opt into `full` through `--response-mode full` or `superdocs config set response-mode full`.

## Safety Model

The CLI assumes local files are valuable and credentials are sensitive.

Current safeguards:

- API keys are stored separately from non-secret config
- credential files reject symlinks
- credential files are written with owner-only permissions where supported
- API keys and bearer tokens are redacted from errors/logs
- empty files fail before upload
- binary and invalid UTF-8 files fail before upload
- empty, binary, and invalid UTF-8 exports fail before overwrite
- writes are atomic
- concurrent writes are locked
- large uploads and jobs can be cancelled
- rate-limit retries respect the configured timeout

The tradeoff is that some edge cases fail early instead of trying to be clever. That is intentional. A document editor should be conservative when local data is at risk.

## Tradeoffs Considered

### Single file script vs structured modules

A single script would be faster to scan initially, but harder to test and harden. The current structure keeps command parsing, SDK calls, file safety, upload strategy, and job orchestration separate.

### Direct synchronous edit vs async job

A synchronous API call would be simpler, but fragile for large documents. Async jobs add complexity but make cancellation, streaming, polling, and long-running edits practical.

### Always stream vs stream with polling fallback

Streaming gives better UX, but not every network path supports SSE reliably. Polling fallback makes the CLI resilient without requiring the user to know what failed.

### Store credentials in OS keychain vs env file

An OS keychain is a good future direction, but cross-platform keychain support adds dependencies and operational complexity. For v1, credentials live in a chosen env file with symlink protection and restrictive permissions.

### Publish source maps vs smaller package

Source maps help debugging, but they increase package size and expose source layout. For public npm consumption, the package ships compiled JS and declarations only.

## Benchmarks

Measured on Windows with Node.js v22.15.1 and npm 10+, using the built `dist/` output.

| Metric                |                Value | Command / Source                                                     |
| --------------------- | -------------------: | -------------------------------------------------------------------- |
| Startup time          |               608 ms | `Measure-Command { node dist/index.js --version }`                   |
| Peak memory           |              59.7 MB | sampled `node dist/index.js --api-url http://127.0.0.1:9 ... status` |
| Build time            |               5.63 s | `Measure-Command { npm run build }`                                  |
| Test count            |             43 tests | `npm test`                                                           |
| Test result           | 42 passed, 1 skipped | symlink test skipped on this Windows environment                     |
| Packed package size   |              43.0 kB | `npm pack --dry-run --json`                                          |
| Unpacked package size |             181.7 kB | `npm pack --dry-run --json`                                          |
| Published file count  |             79 files | `npm pack --dry-run --json`                                          |
| Audit result          |    0 vulnerabilities | `npm audit --audit-level=moderate`                                   |

These numbers are not meant to be universal. They are a baseline for this machine and should be re-measured before major releases.

## Roadmap

Near-term:

- add integration tests against a mock SuperDocs API server
- add explicit `--max-bytes` guidance if API limits become public
- improve watch mode reporting for repeated failures
- document API request/response contracts for SDK consumers

Medium-term:

- optional OS keychain credential backend
- resumable upload support if the API exposes upload checkpoints
- better shell completion value generation from Commander metadata
- richer JSON events for CI systems

Long-term:

- split the SDK into its own package if external usage grows
- provide an MCP server as a separate integration surface
- support additional document formats only when the local safety model is equally strong

The guiding rule: keep the CLI boring where data safety matters, and make the happy path feel fast.
