# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-08-29

Correctness and hygiene release. No new commands.

### Fixed

- **`SUPERDOCS_API_BASE_URL` was ignored.** `--api-url` carried a Commander default of
  `https://api.superdocs.app`, which always populated the option and permanently shadowed the
  environment variable. Anyone pointing the CLI at a self-hosted or development API was
  silently sending their documents to the public API instead. The flag no longer declares a
  default; precedence is now `--api-url`, then `SUPERDOCS_API_BASE_URL`, then the public API.
- `superdocs --version` reported `1.0.0` regardless of the published version. The version is
  now read from `package.json` at runtime, and a test asserts the two cannot drift again.
- `--no-auto-continue` never took effect. Commander represents the negated flag as
  `autoContinue: false`, but the code read a `noAutoContinue` key that is never set, so large
  edits always auto-continued. When the flag is used in a non-interactive terminal the paused
  job is now cancelled instead of abandoned server-side.
- Human-readable status text was written to `stdout`, corrupting redirected output. Most
  visibly, `--git` printed repository details ahead of the document. `stdout` now carries only
  the payload; progress, status, and errors go to `stderr`.
- `--json` printed pretty-formatted objects, so a run emitting progress events plus a result
  could not be parsed. Output is now newline-delimited JSON, one compact object per line,
  stamped with `schema_version`.
- `--git` collected the repository root and changed files, printed them, and discarded them.
  The context is now sent with the instruction, and includes the current branch.
- Watch mode registered `SIGINT`/`SIGTERM` handlers per run without removing them, and
  overlapped with the handler in `edit` and the cleanup manager. Interrupt handling now has a
  single owner; a second Ctrl+C forces an exit.
- The credentials file was protected only by POSIX mode bits, which do nothing on Windows.
  `login` now applies an explicit ACL on win32 and warns when hardening fails.
- Watch mode registered its file watcher only after the first edit finished, so a save made
  during that initial pass was lost until the next unrelated change. The watcher now starts
  first and queued changes are drained once the first pass completes.
- A missing or empty `--prompt` and invalid numeric options exited with the generic code `1`
  instead of the documented usage code `2`. A new `UsageError` maps caller mistakes to `2`
  consistently.
- `--dry-run` emitted ANSI colour codes into redirected output, so a diff piped to a file or
  another program was not machine-safe. The diff is the `stdout` payload, but its colouring
  followed `chalk`'s ambient detection rather than the destination stream, and `chalk` honours
  `FORCE_COLOR` over `NO_COLOR`. Colour now depends on whether `stdout` is a terminal;
  `--no-color` and `NO_COLOR` are unaffected.

### Added

- `--approve <all|ask>` exposes the API's approval mode. `ask` confirms before SuperDocs
  continues a paused edit rather than applying it unattended.
- Integration test suite covering upload, presigned upload, job polling, retry, failure,
  approval, Git context, and stream separation against a mock SuperDocs server.
- End-to-end suite that spawns the built `dist/index.js` against a full mock SuperDocs API,
  covering every command, flag, exit code, and both output streams. This is what surfaced the
  `SUPERDOCS_API_BASE_URL` bug: the suite could not reach its own mock server. Runs are
  sandboxed so they can never read or overwrite a developer's real credentials.
- `pretest` now builds, so the test suite always exercises the current artifact.
- GitHub Actions CI across Linux, macOS, and Windows on Node 20, 22, and 24, plus a release
  workflow that publishes with npm provenance.
- Tests are now typechecked (`npm run check` uses `tsconfig.check.json`).

### Changed

- Dependency overrides updated so `npm audit` reports zero vulnerabilities; production
  dependencies were already clean, the findings were in the dev toolchain.
- `zod` and `ora` are no longer loaded when commands are registered, cutting roughly 40% off
  startup overhead for `--version`, `--help`, and every command that does not need them. A
  test walks the static import graph to keep them off that path.
- The unused plugin registry (`src/plugins/`) is excluded from the published package. It is
  imported by nothing and is scheduled for deletion.

## [1.0.0] - 2026-07-25

### Added

- Core editing with `superdocs edit <file>` for markdown and text files.
- Authentication commands: `superdocs auth login`, `auth status`, and `auth logout`.
- Stdin workflows for piping files, text, and Git diffs.
- Git diff detection for release notes, PR summaries, and reviews.
- Watch mode with debounced re-edits.
- Dry-run mode with unified diffs.
- Streaming job progress with polling fallback.
- Ctrl+C cancellation for jobs and large uploads.
- JSON output for automation.
- Shell completions and install helpers for bash, zsh, and fish.
- User configuration with `config get`, `config set`, and `config list`.
- Model, response mode, output format, timeout, and verbose defaults.
- Semantic exit codes for usage, config, auth, network, API, and timeout failures.
- Public SDK exports for API client integrations.

### Security

- Credentials are stored separately from non-secret CLI configuration.
- Credential env files are written with owner-only permissions where supported.
- Symlinked credential files are rejected.
- API keys and bearer tokens are redacted from errors and logs.
- Empty, binary, and invalid UTF-8 inputs are rejected before upload.
- Empty, binary, and invalid UTF-8 exports are rejected before overwrite.
- Concurrent writes to the same output path are guarded by lock files.

[1.0.2]: https://github.com/AbhinayYendoti/Superdocs-cli/releases/tag/v1.0.2
[1.0.0]: https://github.com/AbhinayYendoti/Superdocs-cli/releases/tag/v1.0.0
