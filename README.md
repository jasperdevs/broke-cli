<h1 align="center">brokecli</h1>
<p align="center">
  <img src="./logos/brokecli-full.svg" alt="brokecli" width="280" />
</p>
<p align="center"><em>A terminal-first AI coding CLI with budget-aware model routing.</em></p>

<p align="center">
  <a href="https://github.com/jasperdevs/broke-cli/stargazers"><img src="https://img.shields.io/github/stars/jasperdevs/broke-cli?style=flat&logo=github&label=stars&color=4c71f2" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-supported-555" alt="Supported on macOS, Linux, and Windows" />
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

- **Budget-aware routing**: pick providers and models directly, or steer toward cheaper capable options
- **Caveman mode**: compressed, low-noise assistant output when you want answers fast
- **Sidebar + workspace state**: model, provider, workspace, and session state stay visible in the TUI
- **Slash commands + settings**: built-in workflows like `/connect`, `/login`, `/model`, `/settings`, `/btw`, and `/budget`
- **Provider + session tools**: hosted APIs, local runtimes, native logins, exports, self-update, and benchmark tasks

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=jasperdevs/broke-cli&type=Date)](https://star-history.com/#jasperdevs/broke-cli&Date)
