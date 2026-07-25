# Developer Experience Audit

This repository is shaped as if it will become the official open-source SuperDocs CLI.
The current command surface is intentionally small, but the UX conventions should scale.

## Benchmarks

| CLI               | Relevant pattern                                                          | Applied here                                               |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| GitHub CLI (`gh`) | Resource-oriented namespaces, readable help, JSON output for automation   | Added `auth` namespace, examples in help, global `--json`  |
| Vercel CLI        | Friendly progress, env-oriented configuration, concise next steps         | Ora progress stages, `.env` support, post-login guidance   |
| Supabase CLI      | Local-first developer workflow, explicit debug mode, stable exit behavior | `--config`, `--verbose`, classified exit codes             |
| Docker CLI        | Consistent global flags, subcommand grouping, shell completion            | Global config flags, `auth` grouping, `completion` command |

## Findings And Improvements

- **Command naming:** Kept `login`, `logout`, and `status` for compatibility, and added the more scalable `auth login`, `auth logout`, and `auth status` namespace.
- **Help output:** Added examples, global configuration notes, sorted options/subcommands, and clearer command summaries.
- **Consistency:** Added shared config loading, logging, and exit-code handling so commands behave the same way.
- **Errors:** Added friendly messages, fix hints, redaction, and stable exit codes.
- **Progress:** Expanded `edit` progress from a single spinner to staged upload, processing, job, export, and save messages.
- **Logging:** Added `--verbose` debug logs, `--quiet` suppression, and `--json` output for automation.
- **Shell ergonomics:** Added `completion <shell>` for bash, zsh, fish, and PowerShell.
- **Configuration:** Added global `--api-key`, `--api-url`, and `--config`, backed by `SUPERDOCS_API_KEY` and `SUPERDOCS_API_BASE_URL`.
- **Documentation:** Expanded README with installation, command examples, config, exit codes, and development workflow.

## Exit Codes

| Code | Meaning                                     |
| ---: | ------------------------------------------- |
|    0 | Success                                     |
|    1 | General error                               |
|    2 | Usage error                                 |
|    3 | Missing or invalid configuration            |
|    4 | Authentication/authorization failure        |
|    5 | Network, retryable, or rate-limit condition |
|    6 | Non-retryable SuperDocs API error           |
|  124 | Timeout                                     |

## Future CLI Surface

Recommended next command groups:

- `superdocs sessions list`
- `superdocs jobs list|get|cancel`
- `superdocs files list|open|export`
- `superdocs templates list|upload|delete`
- `superdocs attachments upload|status|delete`
