<h1 align="center">brokecli</h1>
<p align="center">
  <img src="./logos/brokecli-full.svg" alt="brokecli" width="280" />
</p>
<p align="center">A terminal-first AI coding CLI with budget-aware model routing.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@jasperdevs/brokecli"><img src="https://img.shields.io/npm/v/%40jasperdevs%2Fbrokecli?color=4c71f2" alt="npm version" /></a>
  <a href="https://github.com/jasperdevs/broke-cli/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/jasperdevs/broke-cli/ci.yml?branch=main&label=ci" alt="CI status" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-supported-555" alt="Supported on macOS, Linux, and Windows" />
  <img src="https://img.shields.io/badge/node-%3E%3D18.17-555" alt="Node 18.17+" />
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" alt="brokecli hero placeholder" width="860" />
</p>

## Install

```bash
npm install -g @jasperdevs/brokecli
```

## Start

```bash
brokecli
```

Or run one-shot mode:

```bash
brokecli -p "summarize this repo"
```

Inside the app:

- `/connect <provider>` for API-key providers
- `/login <provider>` for supported native login flows
- `/model` to switch models
- `/settings` to change runtime behavior

## Features

<table>
<tr>
<td width="40%" valign="middle">
<h3>Budget-aware routing</h3>
Pick providers and models explicitly, or let brokecli steer toward cheaper capable options.
</td>
<td width="60%">
<img src="./assets/readme/routing.svg" alt="Budget-aware routing placeholder" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Hosted + local providers</h3>
Works with hosted APIs and local runtimes including Ollama, LM Studio, llama.cpp, Jan, and vLLM.
</td>
<td width="60%">
<img src="./assets/readme/providers.svg" alt="Provider support placeholder" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>TUI + one-shot modes</h3>
Run the full terminal UI, print once, emit JSON, or use RPC depending on the workflow.
</td>
<td width="60%">
<img src="./assets/readme/modes.svg" alt="Runtime modes placeholder" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Sessions and exports</h3>
Persist sessions, resume later, self-update, export transcripts, and run built-in benchmark tasks.
</td>
<td width="60%">
<img src="./assets/readme/sessions.svg" alt="Sessions and exports placeholder" width="100%" />
</td>
</tr>
</table>

## License

MIT
