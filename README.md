# brokecli

AI coding CLI that does the useful parts fast and keeps token waste low.

`brokecli` is a terminal coding assistant with a real TUI, multi-provider model support, session persistence, queueing, export/resume, token controls, compacting, and local-model support.

## Install

```bash
npm install -g @jasperdevs/brokecli
```

## What It Has

- Multi-provider chat and coding flows across OpenAI, Anthropic, Google, Groq, Mistral, xAI, OpenRouter, Ollama, LM Studio, llama.cpp, Jan, and vLLM
- Native CLI passthrough for Claude Code / Codex when local auth is available
- TUI with sidebar, file tree, compact mode, home screen, theme picker, keybindings, and desktop notifications
- Session persistence with current-project `/resume`, `/fork`, transcript export, and per-project recall
- Cost-aware routing, automatic small-model execution on cheap turns, cached execution scaffolds, caveman compression, idle-cliff carry-forward, and token/budget telemetry
- Auto lint/test validation after edits, with optional one-pass auto-fix
- Tool permission blocking and extension enable/disable controls
- JSON RPC mode for non-interactive usage
- Delegated read-only `agent` tool for focused search, research, planning, and review work

## Core Commands

- `/settings` toggle behavior and persistent preferences
- `/connect` configure providers and local endpoints
- `/logout` clear stored brokecli credentials
- `/model` choose the main model
- `/scoped-models` pin or unpin models for `Ctrl+P` cycling
- `/resume` search and resume recent sessions in the current project
- `/session` inspect the active session file, tokens, and cost
- `/projects` search and switch among recently used projects
- `/share` publish a secret GitHub gist when a share token is present, otherwise create a local shareable HTML transcript
- `/budget` inspect cache cliffs, auto-routing, tool waste, and other budget metrics
- `/budget` inspect planner reuse, cheap-vs-main execution share, cache cliffs, and tool waste
- `/permissions` allow/block model tools
- `/extensions` enable/disable loaded extensions
- `/theme` switch themes
- `/compact` compress long conversation context
- `/export` export transcript as markdown/html

## Settings That Matter

The settings surface is in `/settings`. The most important toggles are:

- `auto lint`: run the configured lint command after write/edit tool calls
- `auto test`: run the configured test command after write/edit tool calls
- `auto-fix validation`: send one automatic repair turn if validation fails
- `auto-route`: route cheap/simple requests to a smaller model
- `caveman mode`: reduce output-token waste
- queued steering/follow-up: `Enter` while busy steers after the next tool boundary, `Tab` queues a follow-up after the turn finishes

Config lives under `~/.brokecli/config.json`.

## Tooling Model

The agent has first-class tools for:

- bash
- read file
- write file
- edit file
- list files
- grep
- web search
- web fetch
- todo/task tracking
- delegated stateless agent search/research/plan/review

You can block specific tools with `/permissions`.

For hosted `/share`, set either `BROKECLI_SHARE_GITHUB_TOKEN` or `GITHUB_TOKEN`. Without one, `brokecli` falls back to a local HTML share file and copies its `file:///` URL.

## Extensions

Drop `.js` files into:

```text
~/.brokecli/extensions
```

Extensions register hooks and are isolated so failures do not crash the host. They can also be disabled from `/extensions`.

## RPC Mode

Run non-interactively with:

```bash
brokecli --rpc
```

This uses JSON RPC over stdio and shares the same core runtime as the TUI path.

Other non-interactive modes:

```bash
brokecli -p "explain this stack trace"
brokecli --mode json "summarize this diff"
```

SDK/runtime entry points are exported from [`src/sdk.ts`](./src/sdk.ts), including `createAgentSessionRuntime()`, `runPrintMode()`, and `runJsonMode()`.

## Packages

Package management is built in:

```bash
brokecli install npm:@scope/pkg
brokecli install git:https://github.com/org/pkg.git
brokecli list
brokecli update
brokecli config
```

Packages can contribute extensions, skills, prompts, and themes from global or project scope.

## Local Model Support

Local OpenAI-compatible endpoints are supported out of the box:

- Ollama
- LM Studio
- llama.cpp
- Jan
- vLLM

You can point them at custom base URLs in `~/.brokecli/config.json`.

## Project Status

The repo is active and still evolving, but the product surface is no longer just a stub. The current work is mostly on reliability, runtime polish, and smarter editing behavior.

## License

MIT
