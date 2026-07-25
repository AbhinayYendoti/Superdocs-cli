# Contributing to superdocs-cli

Thank you for your interest in contributing! This guide will help you get started.

## Code of Conduct

By participating, you agree to uphold a welcoming and respectful environment for everyone.

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 10
- A SuperDocs API key (for integration testing)

### Setup

```bash
git clone https://github.com/AbhinayYendoti/Superdocs-cli.git
cd superdocs-cli
npm install
cp .env.example .env
# Add your SUPERDOCS_API_KEY to .env
```

### Development Workflow

```bash
# Run from source (no build step needed)
npm run dev -- edit ./test.md --prompt "Fix typos" --dry-run

# Type-check
npm run check

# Lint
npm run lint

# Format
npm run format

# Build
npm run build
```

## Reporting Issues

Before opening an issue, please:

1. Search [existing issues](https://github.com/AbhinayYendoti/Superdocs-cli/issues) to avoid duplicates
2. Include the Node.js version (`node --version`)
3. Include the CLI version (`superdocs --version`)
4. Include the full error output with `--verbose`
5. Redact any API keys or sensitive data

### Bug Report Template

```
**Describe the bug:**
A clear description of the unexpected behavior.

**To reproduce:**
1. Run `superdocs edit ...`
2. ...

**Expected behavior:**
What you expected to happen.

**Environment:**
- OS: [e.g. macOS 15, Ubuntu 24.04, Windows 11]
- Node.js: [e.g. 22.5.0]
- CLI version: [e.g. 1.0.0]
```

## Pull Requests

### Before You Start

- For **bug fixes**, open an issue first so we can confirm the bug.
- For **new features**, open a discussion or issue to align on scope before writing code.
- For **refactors**, explain the motivation and ensure no behavioral changes.

### PR Checklist

- [ ] Branch from `main`
- [ ] `npm run check` passes (zero TypeScript errors)
- [ ] `npm run lint` passes (zero ESLint errors)
- [ ] `npm run build` succeeds
- [ ] Existing behavior is not broken
- [ ] Commit messages are descriptive
- [ ] README or docs updated if applicable

### Commit Messages

Use clear, imperative-tense commit messages:

```
feat: add --format flag for stdin input
fix: handle empty stdin gracefully
refactor: extract DocumentUploader service
docs: add watch mode examples to README
chore: update dependencies
```

Prefix with a type: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

## Architecture Overview

```
src/
├── commands/       # CLI command handlers
│   ├── edit.ts         # Edit command registration and routing
│   ├── editSingle.ts   # Single edit cycle execution
│   ├── editWatch.ts    # Watch mode loop
│   ├── login.ts        # Auth login
│   ├── logout.ts       # Auth logout
│   ├── status.ts       # Auth status
│   └── completion.ts   # Shell completions
├── config/         # Environment and .env management
├── plugins/        # Plugin registry (lifecycle hooks)
├── sdk/            # SuperDocs API client
│   ├── SuperDocsClient.ts  # REST API wrapper
│   ├── streamClient.ts     # SSE stream consumer
│   └── interfaces.ts       # ISuperDocsClient / IStreamClient
├── services/       # Business logic
│   ├── jobRunner.ts         # Job lifecycle (stream + poll)
│   ├── documentUploader.ts  # Upload strategy
│   └── fileService.ts       # File I/O abstraction
├── types/          # TypeScript types and Zod schemas
└── utils/          # Shared utilities
    ├── diff.ts         # Unified diff generation
    ├── errors.ts       # Error formatting and exit codes
    ├── files.ts        # File reading and atomic writing
    ├── git.ts          # Git integration
    ├── logger.ts       # Logger and spinner
    ├── watcher.ts      # File watching with debounce
    └── profiler.ts     # Performance measurement
```

### Key Design Principles

- **Dependency Inversion**: Services depend on interfaces (`ISuperDocsClient`, `ILogger`), not concrete classes
- **Single Responsibility**: Each module has one clear purpose
- **Open/Closed**: Plugin system allows extensions without modifying core
- **Testability**: All I/O and SDK interactions are behind interfaces for mocking

## Style Guide

- **TypeScript strict mode** with `exactOptionalPropertyTypes`
- **ESM modules** (`"type": "module"` in package.json)
- **No default exports** — use named exports everywhere
- **Prettier** for formatting (see `.prettierrc`)
- **ESLint** with `typescript-eslint` recommended rules

## Release Process

Releases follow [Semantic Versioning](https://semver.org/):

- `PATCH` (1.0.**x**) — bug fixes, documentation
- `MINOR` (1.**x**.0) — new features, backward-compatible
- `MAJOR` (**x**.0.0) — breaking changes

Maintainers handle releases. To request a release, open an issue.

## Questions?

Open a [discussion](https://github.com/AbhinayYendoti/Superdocs-cli/discussions) or reach out on the issue tracker.
