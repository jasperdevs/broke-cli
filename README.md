<h1 align="center">brokecli</h1>
<p align="center">A cost-aware AI coding CLI for developers who want the terminal first and token spend second.</p>

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
# 1) install or sign into a provider
export OPENAI_API_KEY=your_key_here

# 2) launch the terminal ui
brokecli

# 3) or run a one-shot prompt
brokecli -p "summarize the repo"
```

If you already use native CLIs like Codex or Claude Code, brokecli will prefer those authenticated runtimes when they are available.

## Why

brokecli keeps the terminal front and center while making model choice, token spend, and context pressure visible enough to act on. It is designed for developers who want fast interactive coding without treating cost as an afterthought.

## What You Get

- Cost-aware model routing and token visibility
- Terminal-first TUI plus one-shot print/json/rpc modes
- Native-runtime support for authenticated local CLIs when available
- Session persistence, slash commands, benchmarks, and packageable extensions
- CI-verified support on macOS, Linux, and Windows

## Common Commands

```bash
brokecli
brokecli --help
brokecli -p "explain src/core/update.ts"
brokecli --list-models
brokecli self-update
brokecli benchmark --suite fixed
```

## Config

Global config lives at `~/.brokecli/config.json`.

Project-scoped config lives at `.brokecli/config.json` in the current repo.

## Release Notes

- Scoped npm package: `@jasperdevs/brokecli`
- Node support: `>=18.17`
- Build output is generated during `prepare`, `prepack`, and CI

## License

MIT
