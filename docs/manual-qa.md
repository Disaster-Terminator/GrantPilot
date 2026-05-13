# GrantPilot Manual QA

GrantPilot targets ChatGPT Web, so full browser E2E is not treated as reliable.
Use this checklist after loading `src/extension` as an unpacked Chrome / Edge extension.

## Setup

1. Run `pnpm run debug:log-server`.
2. Open a concrete ChatGPT conversation page, such as `https://chatgpt.com/c/<id>`.
3. Enable GrantPilot in the popup for that tab.
4. Enable **Local JSONL log** if log evidence is needed.
5. Keep `tmp/grantpilot/events.jsonl` open in a tailing viewer if possible.

## Approval Card

Expected:

- A bounded GitHub / Gmail / connector approval card with an action such as update, label, send, or create is clicked once.
- The positive button text in logs is deduplicated, for example `确认` instead of `确认 确认`.
- A matching `approval_clicked` event is recorded.

Fail if:

- A generic confirmation dialog is clicked.
- A provider name alone, such as only `GitHub`, is enough to trigger a click.
- A negative button is clicked.

## Dangerous Context

Show or simulate approval text involving deletion, payment, OAuth, login, account management, or admin approval.

Expected:

- GrantPilot does not click the card.
- No `approval_clicked` event is recorded for that card.

Fail if:

- Any dangerous-context card is clicked automatically.

## Page Isolation

Expected:

- Settings apply only to the current tab and current concrete conversation URL.
- ChatGPT home, project pages without `/c/<id>`, and auth pages do not refresh.
- Switching to another conversation does not inherit the previous conversation's settings.

Fail if:

- `page_refresh` appears for `https://chatgpt.com/`.
- Popup controls remain enabled on unsupported pages.

## Auto Refresh

Expected:

- Auto-refresh arms only after an approval click or active generation.
- Normal generation completion records `refresh_disarmed` with `generation_settled`.
- A passive idle conversation does not refresh.
- If the page timer fires, `page_refresh.detail.reason` reflects the page state such as `stuck_generation`.
- If the page timer is throttled or stuck, the background fallback records `page_refresh.detail.reason` as `background_alarm`.

Fail if:

- A normal conversation is refreshed after it visibly settles.
- Refresh happens while an approval card is still visible.
- Refresh settings leak to another tab or conversation.

## Error Surfacing

Expected:

- Visible ChatGPT error text is reflected in the popup and the page banner.
- Repeated scans do not flood identical `chatgpt_error` or `stuck_generation` events.

Fail if:

- Errors are swallowed silently.
- Old conversation text containing an error phrase creates a false current error.
