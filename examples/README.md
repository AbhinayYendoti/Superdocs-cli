# Examples

Practical examples showing common superdocs-cli workflows.

## Basic Editing

### Edit a markdown file

```bash
superdocs edit ./proposal.md --prompt "Make this more concise and professional"
```

### Edit a text file

```bash
superdocs edit ./notes.txt --prompt "Turn these rough notes into polished meeting minutes"
```

### Edit with a different output file

```bash
superdocs edit ./draft.md --output ./draft.final.md --prompt "Polish this document"
```

## Piping

### Pipe a file via stdin

```bash
cat README.md | superdocs edit --prompt "Fix grammar and improve clarity"
```

### Pipe a string

```bash
echo "Hello wrold, this is a tset." | superdocs edit --prompt "Fix all spelling errors"
```

### Chain with other tools

```bash
curl -s https://example.com/page | superdocs edit --prompt "Summarise this page" --format txt
```

## Git Integration

### Generate release notes from a diff

```bash
git diff v0.9.0..v1.0.0 | superdocs edit --prompt "Write release notes from this diff"
```

### Summarise a pull request

```bash
git diff main...feature-branch | superdocs edit --prompt "Write a PR description summarising these changes"
```

### Review staged changes

```bash
git diff --staged | superdocs edit --prompt "Review this code for bugs and suggest improvements"
```

### Include Git context with an edit

`--git` is a modifier, not a standalone mode: it adds the repository root, current branch,
and changed-file list to the instruction. It still needs a file or stdin.

```bash
superdocs edit ./CHANGELOG.md --git --prompt "Summarise what changed on this branch"
```

## Dry Run

### Preview changes before writing

```bash
superdocs edit ./README.md --dry-run --prompt "Improve the introduction paragraph"
```

The output is a coloured unified diff showing additions and removals. No files are modified.

## Watch Mode

### Auto-edit on every save

```bash
superdocs edit ./notes.md --watch --prompt "Keep this document well-structured and concise"
```

Press `Ctrl+C` to stop watching.

### Watch with custom debounce

```bash
superdocs edit ./draft.md --watch --watch-debounce 1000 --prompt "Fix formatting"
```

## Model Selection

### Use a higher-tier model for complex edits

```bash
superdocs edit ./whitepaper.md --model-tier pro --thinking-depth deep \
  --prompt "Restructure this paper for clarity and add section transitions"
```

### Use a fast model for quick fixes

```bash
superdocs edit ./notes.txt --model-tier core --thinking-depth fast \
  --prompt "Fix typos"
```

## JSON Output for Automation

### Use in a CI/CD pipeline

```bash
RESULT=$(superdocs edit ./changelog-draft.md --prompt "Format as a changelog" --json)
echo "$RESULT" | jq '.ok'
```

### Combine with dry run

```bash
superdocs edit ./doc.md --dry-run --json --prompt "Simplify language" | jq -r 'select(.diff).diff'
```

`--json` emits newline-delimited JSON, so pair it with `jq`'s line-by-line reading (the
default) and `select` the object you want. Adding `--verbose` interleaves progress events
into the same stream.

## Shell Completions

### Bash

```bash
superdocs completion bash >> ~/.bashrc
source ~/.bashrc
```

### Zsh

```bash
superdocs completion zsh >> ~/.zshrc
source ~/.zshrc
```

### Fish

```bash
superdocs completion fish > ~/.config/fish/completions/superdocs.fish
```

### PowerShell

```powershell
superdocs completion powershell >> $PROFILE
. $PROFILE
```

## Configuration

### Use a custom env file

```bash
superdocs --config .env.staging auth status
```

### Override the API URL

```bash
superdocs --api-url https://api.staging.superdocs.app edit ./doc.md --prompt "Test"
```

### Quiet mode (suppress progress)

```bash
superdocs --quiet edit ./doc.md --prompt "Fix typos"
```

### Verbose mode (debug logging)

```bash
superdocs --verbose edit ./doc.md --prompt "Fix typos"
```
