import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPageState,
  findApprovalTarget,
  normalizeText
} from "../src/shared/matcher.js";

function candidate(text, options = {}) {
  return {
    text,
    title: options.title ?? text,
    ariaLabel: options.ariaLabel ?? "",
    disabled: options.disabled ?? false,
    visible: options.visible ?? true,
    contextText: options.contextText ?? "",
    pathText: options.pathText ?? ""
  };
}

test("normalizeText decodes mojibake captured from DevTools snippets", () => {
  assert.equal(normalizeText("纭"), "确认");
  assert.equal(normalizeText("鎷掔粷"), "拒绝");
});

test("findApprovalTarget selects the positive confirm button inside a ChatGPT tool card", () => {
  const target = findApprovalTarget([
    candidate("拒绝", {
      contextText: "GitHub Update README.md in Github repository? 使用工具存在风险。了解更多"
    }),
    candidate("确认", {
      title: "确认",
      contextText: "GitHub Update README.md in Github repository? 使用工具存在风险。了解更多"
    })
  ]);

  assert.equal(target?.text, "确认");
  assert.equal(target?.kind, "approval");
});

test("findApprovalTarget never clicks reject or cancel buttons", () => {
  const target = findApprovalTarget([
    candidate("拒绝", {
      contextText: "GitHub Update README.md in Github repository? 使用工具存在风险。了解更多"
    }),
    candidate("Cancel", {
      contextText: "GitHub Update README.md in Github repository? Tool call"
    })
  ]);

  assert.equal(target, null);
});

test("findApprovalTarget rejects generic confirm buttons without tool-card context", () => {
  const target = findApprovalTarget([
    candidate("确认", {
      contextText: "Delete this conversation?"
    })
  ]);

  assert.equal(target, null);
});

test("classifyPageState reports ChatGPT visible error text", () => {
  const state = classifyPageState({
    visibleText: "ChatGPT 也可能会犯错。Something went wrong while generating the response.",
    hasStopButton: false,
    now: 100,
    generationStartedAt: null,
    stuckThresholdMs: 30000
  });

  assert.equal(state.status, "chatgpt_error");
  assert.match(state.reason, /Something went wrong/i);
});

test("classifyPageState reports stuck generation after threshold", () => {
  const state = classifyPageState({
    visibleText: "Received app response",
    hasStopButton: true,
    now: 61000,
    generationStartedAt: 0,
    stuckThresholdMs: 60000
  });

  assert.equal(state.status, "stuck_generation");
});

test("classifyPageState keeps active generation before threshold", () => {
  const state = classifyPageState({
    visibleText: "Received app response",
    hasStopButton: true,
    now: 30000,
    generationStartedAt: 0,
    stuckThresholdMs: 60000
  });

  assert.equal(state.status, "generating");
});
