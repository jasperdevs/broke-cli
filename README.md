<h1 align="center">brokecli</h1>
<p align="center">
  <img src="./logos/brokecli-full.svg" alt="brokecli" width="280" />
</p>
<p align="center">A terminal-first AI coding CLI with budget-aware model routing.</p>

<p align="center">
  <a href="https://github.com/jasperdevs/broke-cli/stargazers"><img src="https://img.shields.io/github/stars/jasperdevs/broke-cli?style=flat&logo=github&label=stars&color=4c71f2" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Linux%20%7C%20Windows-supported-555" alt="Supported on macOS, Linux, and Windows" />
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
<h3>Caveman mode</h3>
Compresses assistant output hard when you want blunt, low-noise answers without changing code blocks or exact technical terms.
</td>
<td width="60%">
<img src="./assets/readme/routing.svg" alt="Budget-aware routing placeholder" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Sidebar + workspace state</h3>
The TUI keeps model, provider, workspace, and session state visible instead of hiding everything behind a blank prompt.
</td>
<td width="60%">
<img src="./assets/readme/providers.svg" alt="Provider support placeholder" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Slash commands + settings</h3>
Built-in commands like <code>/connect</code>, <code>/login</code>, <code>/model</code>, <code>/settings</code>, <code>/btw</code>, <code>/budget</code>, and more are part of the main workflow.
</td>
<td width="60%">
<img src="./assets/readme/modes.svg" alt="Runtime modes placeholder" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Provider routing + session tools</h3>
Mix hosted APIs, local runtimes, and supported native logins, then keep sessions, exports, self-update, and benchmark tasks in the same CLI.
</td>
<td width="60%">
<img src="./assets/readme/sessions.svg" alt="Sessions and exports placeholder" width="100%" />
</td>
</tr>
</table>

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jasperdevs/broke-cli&type=Date)](https://star-history.com/#jasperdevs/broke-cli&Date)
