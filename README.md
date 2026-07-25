# superdocs-cli

Edit markdown and text files with SuperDocs from your terminal.

SuperDocs is an AI document editing service. This CLI sends a file, stdin, or Git diff to SuperDocs with your instruction, then writes the edited result back to disk or stdout.

## 30-Second Start

Install:

```bash
npm install -g superdocs-cli
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

Inspect Git context directly:

```bash
superdocs edit --git --prompt "Review changed files"
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

Credentials are stored in the credentials env file, `.env` by default. Use `--config <path>` to choose another credentials file.

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
| `superdocs auth login`                 | Save and verify an API key          |
| `superdocs auth status`                | Check API health and authentication |
| `superdocs auth logout`                | Remove the saved API key            |
| `superdocs status`                     | Alias for `auth status`             |
| `superdocs edit <file>`                | Edit a markdown or text file        |
| `superdocs config get <key>`           | Print one config value              |
| `superdocs config set <key> <value>`   | Save one config value               |
| `superdocs config list`                | Print all config values             |
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
| `-d, --dry-run`            | Show a diff without writing           |
| `-w, --watch`              | Re-edit when the file changes         |
| `--git`                    | Inspect Git context and changed files |
| `--timeout-seconds <n>`    | Max wait time                         |
| `--json`                   | Machine-readable output               |
| `--verbose`                | Debug logs                            |

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
