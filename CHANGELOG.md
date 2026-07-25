# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/AbhinayYendoti/Superdocs-cli/releases/tag/v1.0.0
