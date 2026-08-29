# superdocs-app-cli

Edit markdown and text files with SuperDocs from your terminal.

SuperDocs is an AI document editing service. This CLI sends a file, stdin, or Git diff to SuperDocs with your instruction, then writes the edited result back to disk or stdout.

## 30-Second Start

Install:

```bash
npm install -g superdocs-app-cli
```

Authenticate:

```bash
superdocs auth login
superdocs auth status
```

Edit a file:

```bash
superdocs edit ./proposal.md --prompt "Make this clearer and more concise"
```

Use stdin:

```bash
cat ./notes.md | superdocs edit --prompt "Turn these notes into a polished summary"
```

Use it with Git:

```bash
git diff | superdocs edit --prompt "Write release notes for these changes"
```

That is the main loop: provide text, describe the edit, get improved text back.

## Common Examples

Edit a markdown file in place:

```bash
superdocs edit ./README.md --prompt "Fix typos and improve clarity"
```

Edit a text file:

```bash
superdocs edit ./meeting-notes.txt --prompt "Turn this into clean meeting minutes"
```

Write the result to a new file:

```bash
superdocs edit ./draft.md --output ./draft.edited.md --prompt "Make this more persuasive"
```

Preview the diff without changing the file:

```bash
superdocs edit ./proposal.md --dry-run --prompt "Tighten the language"
```

Pipe text in and print the result:

```bash
echo "hello wrold" | superdocs edit --prompt "Fix spelling"
```

Save stdin output to a file:

```bash
cat ./rough.md | superdocs edit --output ./clean.md --prompt "Clean this up"
```

Summarize staged Git changes:

```bash
git diff --staged | superdocs edit --prompt "Summarize this PR"
```

Review current Git changes:

```bash
git diff | superdocs edit --prompt "Review these changes and call out risks"
```

Include repository context in the request. `--git` adds the repository root, current
branch, and changed-file list to the instruction sent to SuperDocs:

```bash
superdocs edit ./CHANGELOG.md --git --prompt "Summarise the work on this branch"
```

## Authentication

Interactive login:

```bash
superdocs auth login
```

Non-interactive login:

```bash
superdocs auth login --api-key "$SUPERDOCS_API_KEY"
```

Check your setup:

```bash
superdocs auth status
```

Log out:

```bash
superdocs auth logout
```

Credentials are stored in a global `credentials.json` file:

- Windows: `%APPDATA%/SuperDocs/credentials.json`
- macOS: `~/Library/Application Support/SuperDocs/credentials.json`
- Linux: `~/.config/SuperDocs/credentials.json`

The CLI also accepts `SUPERDOCS_API_KEY` or `--api-key` as temporary overrides.

The credentials file is restricted to your account: mode `0600` on macOS and Linux, and an
explicit ACL on Windows. `superdocs auth login` warns if it cannot apply those permissions.

## Configuration

Use `superdocs config` for non-secret defaults. These are stored separately from credentials.

```bash
superdocs config set default-model pro
superdocs config set response-mode compact
superdocs config set output-format markdown
superdocs config set timeout 600
superdocs config set verbose false
```

Read config:

```bash
superdocs config get default-model
superdocs config list
```

Supported keys:

| Key             | Values                        |
| --------------- | ----------------------------- |
| `default-model` | `core`, `turbo`, `pro`, `max` |
| `response-mode` | `compact`, `full`             |
| `output-format` | `markdown`, `txt`             |
| `timeout`       | Positive seconds              |
| `verbose`       | `true`, `false`               |

Command-line flags override saved config.

## Shell Completion

Install completion:

```bash
superdocs completion install bash
superdocs completion install zsh
superdocs completion install fish
```

Or print a completion script:

```bash
eval "$(superdocs completion bash)"
superdocs completion zsh > ~/.zsh/completions/_superdocs
superdocs completion fish > ~/.config/fish/completions/superdocs.fish
```

## Command Reference

| Command                                | Description                         |
| -------------------------------------- | ----------------------------------- |
| `superdocs auth login`                 | Sign in to SuperDocs                |
| `superdocs auth status`                | Check connection and sign-in status |
| `superdocs auth logout`                | Sign out of SuperDocs               |
| `superdocs status`                     | Alias for `auth status`             |
| `superdocs edit <file>`                | Edit a markdown or text file        |
| `superdocs config get <key>`           | Show one saved preference           |
| `superdocs config set <key> <value>`   | Save one preference                 |
| `superdocs config list`                | Show saved preferences              |
| `superdocs completion <shell>`         | Print a completion script           |
| `superdocs completion install <shell>` | Install completion for a shell      |

## Edit Options

| Flag                       | Description                           |
| -------------------------- | ------------------------------------- |
| `-p, --prompt <prompt>`    | Editing instruction                   |
| `-o, --output <file>`      | Write output to another path          |
| `--format <format>`        | Stdin format: `markdown`, `txt`       |
| `--model-tier <tier>`      | `core`, `turbo`, `pro`, `max`         |
| `--response-mode <mode>`   | `compact`, `full`                     |
| `--thinking-depth <depth>` | `fast`, `balanced`, `deep`            |
| `--approve <mode>`         | `all` (unattended) or `ask`           |
| `--no-auto-continue`       | Stop instead of continuing a pause    |
| `-d, --dry-run`            | Print a diff without writing          |
| `-w, --watch`              | Re-edit when the file changes         |
| `--git`                    | Send Git context with the instruction |
| `--timeout-seconds <n>`    | Max wait time                         |
| `--json`                   | Newline-delimited JSON output         |
| `--verbose`                | Debug logs                            |

## Output Streams

`stdout` carries only the payload; everything else goes to `stderr`. That makes redirection
and piping safe:

```bash
# The edited document, and nothing else, lands in clean.md
cat rough.md | superdocs edit --prompt "Clean this up" > clean.md

# A usable patch file; progress and status still print to the terminal
superdocs edit ./README.md --dry-run --prompt "Fix typos" > fixes.patch
```

With `--json` the CLI emits newline-delimited JSON - one compact object per line, each
carrying a `schema_version` - so it can be consumed as a stream:

```bash
superdocs edit ./doc.md --prompt "Tighten this" --json | jq -c 'select(.ok != null)'
```

## Approvals

By default `superdocs edit` applies changes unattended, which is what CI needs. To confirm
before SuperDocs continues a large edit, run it interactively:

```bash
superdocs edit ./spec.md --approve ask --prompt "Restructure this document"
```

`--no-auto-continue` stops the edit at a pause instead of continuing. In a non-interactive
terminal the paused job is cancelled and the command exits with an explanatory error rather
than hanging or silently applying the change.

## Development

```bash
npm install
npm run dev -- -- --help
npm run check
npm run lint
npm test
npm run build
```

## License

[MIT](./LICENSE) (c) SuperDocs
