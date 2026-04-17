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
brokecli --broke
```

Or run one-shot mode:

```bash
brokecli -p "summarize this repo"
brokecli --broke -p "summarize this repo"
```

Inside the app:

- `/login <provider>` for supported native/OAuth login flows
- `/model` to switch models
- `/packages` to inspect installed packages or search/install from npm
- `/settings` to change runtime behavior
- custom providers and model overrides via [`docs/models.md`](./docs/models.md)

## Verify

Run the local quality gate before sending changes:

```bash
npm run verify
```

That is the canonical CI-level gate: build, typecheck, quality checks, circular-dependency checks, unused-file checks, the test suite, pack dry run, CLI help smoke test, and release smoke test.

CI runs `npm run verify` on Node 20 across macOS, Linux, and Windows, plus a separate minimum Node 18 build/test smoke.

## Features

<table>
<tr>
<td width="40%" valign="middle">
<h3>Budget-aware routing</h3>
Pick providers and models directly, or use broke mode to bias toward cheaper capable options.
</td>
<td width="60%">
&nbsp;
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Caveman mode</h3>
Ultra, lite, and auto output compression when you want less filler and faster reads.
</td>
<td width="60%">
&nbsp;
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Sidebar + workspace state</h3>
The TUI keeps model, provider, workspace, and session state visible instead of hiding everything behind a blank prompt.
</td>
<td width="60%">
&nbsp;
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>30+ slash commands + settings</h3>
Built-in workflows like <code>/login</code>, <code>/model</code>, <code>/settings</code>, <code>/packages</code>, <code>/btw</code>, <code>/budget</code>, <code>/export</code>, and <code>/resume</code>.
</td>
<td width="60%">
&nbsp;
</td>
</tr>
<tr>
<td width="40%" valign="middle">
<h3>Provider + session tools</h3>
Native/OAuth logins, local runtimes, session persistence, branch forking in the session tree, exports, self-update, and benchmark tasks in one CLI.
</td>
<td width="60%">
&nbsp;
</td>
</tr>
</table>

## License

MIT

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=jasperdevs/broke-cli&type=Date)](https://star-history.com/#jasperdevs/broke-cli&Date)
