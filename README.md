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

<table>
<tr>
<td width="40%" valign="middle">
<h3>Budget-aware routing</h3>
Pick providers and models directly, or steer toward cheaper capable options.
</td>
<td width="60%">
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Caveman mode</h3>
Compressed, low-noise assistant output when you want answers fast.
</td>
<td width="60%">
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Sidebar + workspace state</h3>
Model, provider, workspace, and session state stay visible in the TUI.
</td>
<td width="60%">
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Slash commands + settings</h3>
Built-in workflows like <code>/connect</code>, <code>/login</code>, <code>/model</code>, <code>/settings</code>, <code>/btw</code>, and <code>/budget</code>.
</td>
<td width="60%">
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="" width="100%" />
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Provider + session tools</h3>
Hosted APIs, local runtimes, native logins, exports, self-update, and benchmark tasks in one CLI.
</td>
<td width="60%">
<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="" width="100%" />
</td>
</tr>
</table>

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=jasperdevs/broke-cli&type=Date)](https://star-history.com/#jasperdevs/broke-cli&Date)
