# GrantPilot

<p>
  <img alt="extension Manifest V3" src="https://img.shields.io/badge/extension-MV3-4285F4">
  <img alt="target ChatGPT Web" src="https://img.shields.io/badge/target-ChatGPT%20Web-10A37F">
  <img alt="browser Chrome / Edge" src="https://img.shields.io/badge/browser-Chrome%20%2F%20Edge-5F6368">
  <img alt="dev Node.js 18+" src="https://img.shields.io/badge/dev-Node.js%2018%2B-339933">
</p>

[简体中文](./README.md)

GrantPilot is a small Chrome / Edge Manifest V3 extension for ChatGPT Web. When you explicitly enable it from the popup, it watches the current ChatGPT page for app / tool approval cards and clicks only the card-local positive confirmation button.

It is designed for one narrow workflow: reducing repetitive confirmation clicks when ChatGPT asks you to approve a connector, app, MCP, or tool action that you already intend to allow.

## What it is not

GrantPilot is intentionally not a generic auto-clicker.

It does not handle:

- External OAuth or login pages.
- Payment, deletion, account, or admin approval flows.
- Broad permission-upgrade pages outside ChatGPT Web.
- Negative buttons such as `Reject`, `Deny`, `Cancel`, `拒绝`, or `取消`.

If a page is not a ChatGPT tool / app approval card, GrantPilot should do nothing.

## Behavior

- Runs only on `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- Starts disabled by default.
- Requires you to enable it from the extension popup.
- Looks for positive labels such as `确认`, `允许`, `批准`, `继续`, `Confirm`, `Allow`, `Approve`, and `Continue`.
- Treats negative labels only as safety boundaries and never clicks them.
- Requires nearby tool / app / connector context before clicking.
- Surfaces visible ChatGPT errors in the popup and in a small page banner.
- Can optionally auto-refresh an idle ChatGPT page when no approval card and no generation control are visible.

## Install locally

1. Clone this repository.
2. Open `edge://extensions` or `chrome://extensions`.
3. Enable developer mode.
4. Choose **Load unpacked**.
5. Select `src/extension` inside this repository.
6. Open ChatGPT Web, open the GrantPilot popup, and enable it only on the page where you want it to act.

## Popup controls

- **Enabled**: turns approval-card scanning on or off.
- **Auto refresh**: reloads idle ChatGPT pages at the selected interval.
- **Refresh interval**: chooses the idle refresh interval.
- **Local JSONL log**: sends event records to the optional local debug server.
- **Last issue / Recent events**: shows recent clicks, refreshes, runtime errors, and ChatGPT-visible issues.

## Debug logs

Recent events are stored in extension local storage and shown in the popup.

For a local JSONL log file, run:

```bash
npm run debug:log-server
```

Then enable **Local JSONL log** in the popup. By default, events are posted to `http://127.0.0.1:17762/events` and appended to `tmp/grantpilot/events.jsonl`.

You can override the debug server with environment variables:

```bash
GRANTPILOT_DEBUG_HOST=127.0.0.1 \
GRANTPILOT_DEBUG_PORT=17762 \
GRANTPILOT_DEBUG_LOG=tmp/grantpilot/events.jsonl \
npm run debug:log-server
```

## Manual checks

Full browser automation against ChatGPT Web is intentionally not treated as reliable. Use these manual checks before relying on the extension:

- Disabled state: show a ChatGPT app / tool approval card and confirm no click happens.
- Enabled state: show a card such as `Update README.md in GitHub repository?` and confirm the positive `确认` / `Allow` button is clicked.
- Safety: confirm the negative `拒绝` / `Cancel` button is never clicked.
- Error surfacing: when ChatGPT shows a generation error, confirm the popup and page banner surface it.
- Auto-refresh: enable auto-refresh and confirm idle pages reload only after the selected interval.

## Development

Install dependencies if needed, then run:

```bash
npm test
npm run check
```

`npm test` runs the matcher tests under `tests/*.test.mjs`.

`npm run check` performs syntax checks for the extension scripts, shared matcher code, and `manifest.json`.

## Repository layout

```text
src/extension/          MV3 extension files
  manifest.json         Chrome / Edge extension manifest
  background.js         settings, event storage, badge state, local log forwarding
  content-script.js     ChatGPT page scanning, approval detection, error banner, auto-refresh
  popup.html            extension popup UI
  popup.js              popup state binding and setting updates
  popup.css             popup styling
src/shared/             pure matching and text helpers used by tests
tests/                  node:test coverage for matcher behavior
scripts/                optional local JSONL debug log server
```
