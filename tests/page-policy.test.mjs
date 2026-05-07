import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyChatGptPage,
  getRefreshIntervalMs,
  shouldRefreshNow
} from "../src/shared/page-policy.js";

test("classifyChatGptPage allows only concrete ChatGPT conversation pages", () => {
  assert.deepEqual(classifyChatGptPage("https://chatgpt.com/c/abc-123"), {
    supported: true,
    reason: "conversation"
  });
  assert.deepEqual(classifyChatGptPage("https://chatgpt.com/g/project-1/c/abc-123"), {
    supported: true,
    reason: "conversation"
  });
  assert.equal(classifyChatGptPage("https://chatgpt.com/").supported, false);
  assert.equal(classifyChatGptPage("https://chatgpt.com/g/project-1").supported, false);
  assert.equal(classifyChatGptPage("https://auth.openai.com/u/login").supported, false);
});

test("getRefreshIntervalMs uses a 10 second minimum and backs off", () => {
  assert.equal(getRefreshIntervalMs(0), 10000);
  assert.equal(getRefreshIntervalMs(1), 15000);
  assert.equal(getRefreshIntervalMs(2), 30000);
  assert.equal(getRefreshIntervalMs(3), 60000);
  assert.equal(getRefreshIntervalMs(4), 120000);
  assert.equal(getRefreshIntervalMs(99), 300000);
});

test("shouldRefreshNow blocks homepage refresh even when auto refresh is enabled", () => {
  const decision = shouldRefreshNow({
    enabled: true,
    autoRefresh: true,
    url: "https://chatgpt.com/",
    pageStatus: "idle",
    hasApprovalTarget: false,
    refreshCount: 0,
    now: 20000,
    lastActivityAt: 0
  });

  assert.deepEqual(decision, {
    refresh: false,
    reason: "not_conversation_page"
  });
});

test("shouldRefreshNow waits for the current distributed interval", () => {
  assert.equal(shouldRefreshNow({
    enabled: true,
    autoRefresh: true,
    url: "https://chatgpt.com/c/abc",
    pageStatus: "idle",
    hasApprovalTarget: false,
    refreshCount: 0,
    now: 9999,
    lastActivityAt: 0
  }).refresh, false);

  assert.deepEqual(shouldRefreshNow({
    enabled: true,
    autoRefresh: true,
    url: "https://chatgpt.com/c/abc",
    pageStatus: "idle",
    hasApprovalTarget: false,
    refreshCount: 0,
    now: 10000,
    lastActivityAt: 0
  }), {
    refresh: true,
    reason: "idle",
    intervalMs: 10000
  });
});

test("shouldRefreshNow does not refresh during active generation, errors, or approval cards", () => {
  for (const blocked of [
    { pageStatus: "generating", hasApprovalTarget: false, reason: "generating" },
    { pageStatus: "chatgpt_error", hasApprovalTarget: false, reason: "chatgpt_error" },
    { pageStatus: "idle", hasApprovalTarget: true, reason: "approval_target_present" }
  ]) {
    const decision = shouldRefreshNow({
      enabled: true,
      autoRefresh: true,
      url: "https://chatgpt.com/c/abc",
      pageStatus: blocked.pageStatus,
      hasApprovalTarget: blocked.hasApprovalTarget,
      refreshCount: 0,
      now: 30000,
      lastActivityAt: 0
    });

    assert.equal(decision.refresh, false);
    assert.equal(decision.reason, blocked.reason);
  }
});
