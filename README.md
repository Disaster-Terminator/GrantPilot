# GrantPilot

GrantPilot is a narrow Chrome/Edge MV3 extension for ChatGPT Web. When the user explicitly enables it, it scans ChatGPT pages for app/tool approval cards and clicks only the positive confirmation button in that card.

It is not a generic auto-clicker and it does not handle external OAuth, login, payment, deletion, admin approval, or broad permission upgrade pages.

## Scope

- Runs only on `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- Default state is disabled.
- Positive targets include card-local `确认`, `Allow`, `Approve`, `Confirm`, and `Continue`.
- Negative buttons such as `拒绝`, `取消`, `Reject`, `Deny`, and `Cancel` are recognized only as safety boundaries and are never clicked.
- ChatGPT visible errors are surfaced to the popup and a small page banner.
- Optional auto-refresh reloads the page only when enabled, no approval card is present, and no generation control is visible.

## Load Locally

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select `G:\repository\GrantPilot\src\extension`.
5. Open the popup and enable GrantPilot only on the ChatGPT page where you want it to act.

## Debug Logs

Recent events are kept in extension local storage and shown in the popup.

For a JSONL log file, run:

```bash
npm run debug:log-server
```

Then enable "Local JSONL log" in the popup. Events are written to `tmp/grantpilot/events.jsonl` by default.

## Manual E2E Checks

Full e2e automation against ChatGPT is intentionally not assumed reliable. Use these manual checks:

- Disabled state: show a ChatGPT app/tool approval card and confirm no click happens.
- Enabled state: show a card like "Update README.md in GitHub repository?", then confirm the right-side `确认` button is clicked.
- Safety: verify the left-side `拒绝` button is never clicked.
- Error surfacing: when ChatGPT shows a generation error, verify the popup last issue and page banner show it.
- Auto-refresh: enable auto-refresh and verify idle pages reload only after the selected interval.

## Development

```bash
npm test
npm run check
```
