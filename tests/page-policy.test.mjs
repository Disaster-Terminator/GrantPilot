import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyChatGptPage,
  computeJitteredRefreshIntervalMs,
  normalizeRefreshIntervalMs,
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

test("normalizeRefreshIntervalMs accepts only simple fixed choices", () => {
  assert.equal(normalizeRefreshIntervalMs(10000), 10000);
  assert.equal(normalizeRefreshIntervalMs(20000), 20000);
  assert.equal(normalizeRefreshIntervalMs(30000), 30000);
  assert.equal(normalizeRefreshIntervalMs(60000), 20000);
  assert.equal(normalizeRefreshIntervalMs("bad"), 20000);
});

test("computeJitteredRefreshIntervalMs keeps the minimum option near 10 seconds", () => {
  assert.equal(computeJitteredRefreshIntervalMs(10000, 0), 8500);
  assert.equal(computeJitteredRefreshIntervalMs(10000, 1), 12000);
  assert.equal(computeJitteredRefreshIntervalMs(20000, 0.5), 20500);
  assert.equal(computeJitteredRefreshIntervalMs(30000, 1), 36000);
});

test("shouldRefreshNow blocks homepage refresh even when auto refresh is enabled and armed", () => {
  const decision = shouldRefreshNow({
    enabled: true,
    autoRefresh: true,
    url: "https://chatgpt.com/",
    pageStatus: "idle",
    hasApprovalTarget: false,
    refreshArmed: true,
    nextRefreshAt: 10000,
    now: 20000
  });

  assert.deepEqual(decision, {
    refresh: false,
    reason: "not_conversation_page"
  });
});

test("shouldRefreshNow does not refresh a passive conversation page before activity arms it", () => {
  const decision = shouldRefreshNow({
    enabled: true,
    autoRefresh: true,
    url: "https://chatgpt.com/c/abc",
    pageStatus: "idle",
    hasApprovalTarget: false,
    refreshArmed: false,
    nextRefreshAt: 0,
    now: 30000
  });

  assert.deepEqual(decision, {
    refresh: false,
    reason: "not_armed"
  });
});

test("shouldRefreshNow waits until the armed randomized deadline", () => {
  assert.equal(shouldRefreshNow({
    enabled: true,
    autoRefresh: true,
    url: "https://chatgpt.com/c/abc",
    pageStatus: "idle",
    hasApprovalTarget: false,
    refreshArmed: true,
    nextRefreshAt: 12000,
    now: 11999
  }).refresh, false);

  assert.deepEqual(shouldRefreshNow({
    enabled: true,
    autoRefresh: true,
    url: "https://chatgpt.com/c/abc",
    pageStatus: "idle",
    hasApprovalTarget: false,
    refreshArmed: true,
    nextRefreshAt: 12000,
    now: 12000
  }), {
    refresh: true,
    reason: "idle"
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
      refreshArmed: true,
      nextRefreshAt: 0,
      now: 30000
    });

    assert.equal(decision.refresh, false);
    assert.equal(decision.reason, blocked.reason);
  }
});
