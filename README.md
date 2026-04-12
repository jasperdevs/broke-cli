<h1 align="center">brokecli</h1>
<p align="center">
  <img src="./logos/brokecli-full.svg" alt="brokecli" width="280" />
</p>
<p align="center">A terminal-first AI coding CLI with budget-aware model routing.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jasperdevs/brokecli"><img src="https://img.shields.io/npm/v/%40jasperdevs%2Fbrokecli?color=111111" alt="npm version" /></a>
  <a href="https://github.com/jasperdevs/broke-cli/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jasperdevs/broke-cli/ci.yml?branch=main&label=ci" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-supported-111111" alt="Supported on macOS, Linux, and Windows" />
  <img src="https://img.shields.io/badge/node-%3E%3D18.17-111111" alt="Node 18.17+" />
</p>

## Install

```bash
npm install -g @jasperdevs/brokecli
```

## Quick Start

```bash
# launch the terminal ui
brokecli
```

Then, inside the app:

- Use `/connect <provider>` for API-key providers such as `openai`, `anthropic`, `google`, `groq`, `mistral`, `xai`, or `openrouter`
- Use `/login <provider>` for native login flows such as `codex`, `github-copilot`, `google-gemini-cli`, or `google-antigravity`
- Or stay non-interactive with `brokecli -p "summarize the repo"`

If a native CLI is already authenticated and available on `PATH`, brokecli will use it when that runtime is supported.

## What It Actually Ships

- Terminal UI plus `--print`, `--mode json`, and `--rpc`
- Budget-aware model routing and token/cost visibility
- Hosted provider support for OpenAI, Anthropic, Google, Groq, Mistral, xAI, and OpenRouter
- Local provider support for Ollama, LM Studio, llama.cpp, Jan, and vLLM
- Native-login support where available for Codex, Claude Code, GitHub Copilot, Google Cloud Code Assist, and Antigravity
- Session persistence, slash commands, transcript export, self-update, and benchmark tasks
- CI coverage on macOS, Linux, and Windows

## Common Commands

```bash
brokecli
brokecli --help
brokecli --list-models
brokecli --mode json -p "summarize this repo"
brokecli -p "explain src/core/update.ts"
brokecli self-update
brokecli benchmark --suite fixed
```

## Config

Global config lives at `~/.brokecli/config.json`.

Project-scoped config lives at `.brokecli/config.json` in the current repo.

## Compatibility

- Scoped npm package: `@jasperdevs/brokecli`
- Node support: `>=18.17`
- Verified in CI on `macos-latest`, `ubuntu-latest`, and `windows-latest`
- Build artifacts are generated during `prepare`, `prepack`, and CI

## License

MIT
