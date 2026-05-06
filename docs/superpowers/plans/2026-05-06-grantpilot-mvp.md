# GrantPilot MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a narrow Chrome/Edge MV3 extension that can auto-confirm ChatGPT app/tool approval cards, surface ChatGPT page errors, keep local logs, and optionally refresh stuck pages.

**Architecture:** Keep the risky behavior in a small content script that only runs on ChatGPT domains. Put approval-card matching and page-state classification into pure modules with Node tests, then have the content script call those modules against the real DOM. Store settings and recent events in extension storage so the popup can show the current state.

**Tech Stack:** Plain MV3 JavaScript modules, Chrome extension APIs, Node built-in test runner, no build step.

---

### Task 1: Core Matching and Page State

**Files:**
- Create: `src/shared/text.js`
- Create: `src/shared/matcher.js`
- Create: `tests/matcher.test.mjs`

- [ ] Write tests for identifying a ChatGPT approval card with `确认` and `拒绝` buttons.
- [ ] Write tests proving negative buttons are never returned as click targets.
- [ ] Write tests for ChatGPT error text detection and generation-in-progress/stuck classification.
- [ ] Implement the minimal pure functions to pass those tests.

### Task 2: Extension Runtime

**Files:**
- Create: `src/extension/manifest.json`
- Create: `src/extension/content-script.js`
- Create: `src/extension/background.js`
- Create: `src/extension/popup.html`
- Create: `src/extension/popup.css`
- Create: `src/extension/popup.js`

- [ ] Implement default-disabled settings in `chrome.storage.local`.
- [ ] Scan the current page on interval and DOM mutation when enabled.
- [ ] Click only the selected positive approval button.
- [ ] Report `chatgpt_error` and `stuck_generation` states to the background and popup.
- [ ] Add an optional auto-refresh setting that reloads only when no approval card is present and generation is not active.

### Task 3: Logging and Documentation

**Files:**
- Create: `scripts/debug-log-server.mjs`
- Modify: `README.md`
- Create: `package.json`

- [ ] Keep an in-extension ring buffer of recent events.
- [ ] Add an optional local JSONL debug log server copied in spirit from Duologue.
- [ ] Document manual loading, manual e2e checks, safety limits, and debug logging.

### Task 4: Verification

**Files:**
- Modify as needed from previous tasks.

- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Inspect the final diff for accidental broad permissions or unrelated files.
