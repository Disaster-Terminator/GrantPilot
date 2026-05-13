import { includesAnyText, normalizeText } from "./text.js";

export { normalizeText };

const POSITIVE_BUTTON_TEXT = [
  "确认",
  "允许",
  "批准",
  "继续",
  "Confirm",
  "Allow",
  "Approve",
  "Continue"
];

const NEGATIVE_BUTTON_TEXT = [
  "拒绝",
  "取消",
  "Deny",
  "Reject",
  "Cancel"
];

const TOOL_CONTEXT_TEXT = [
  "使用工具存在风险",
  "Received app response",
  "MCP",
  "工具",
  "连接器",
  "应用"
];
const TOOL_WORD_RE = /\b(app response|tool|connector|mcp)\b/i;
const PROVIDER_RE = /\b(GitHub|Gmail|Google|Drive|Calendar|Slack|Notion|Linear)\b/i;
const ACTION_RE = /\b(create|update|apply|label|send|post|open|run|read|write|search|repository|messages?|files?|pull request)\b/i;
const DANGEROUS_CONTEXT_RE = /\b(delete|remove|payment|billing|oauth|login|password|account|admin|administrator)\b/i;

const ERROR_TEXT = [
  "Something went wrong",
  "There was an error",
  "An error occurred",
  "Unable to generate",
  "Network error",
  "message stream interrupted",
  "Hmm...something seems to have gone wrong",
  "出了点问题",
  "发生错误",
  "网络错误",
  "无法生成"
];

export function classifyButton(candidate) {
  const label = normalizeText([
    candidate?.text,
    candidate?.title,
    candidate?.ariaLabel
  ].filter(Boolean).join(" "));

  if (!label || candidate?.disabled || candidate?.visible === false) {
    return "irrelevant";
  }

  if (includesAnyText(label, NEGATIVE_BUTTON_TEXT)) {
    return "negative";
  }

  if (includesAnyText(label, POSITIVE_BUTTON_TEXT)) {
    return "positive";
  }

  return "irrelevant";
}

export function hasToolContext(candidate) {
  const context = normalizeText([
    candidate?.contextText,
    candidate?.pathText
  ].filter(Boolean).join(" "));
  if (context.length < 30 || context.length > 2500) {
    return false;
  }
  if (DANGEROUS_CONTEXT_RE.test(context)) {
    return false;
  }
  if (includesAnyText(context, TOOL_CONTEXT_TEXT) || TOOL_WORD_RE.test(context)) {
    return true;
  }
  return PROVIDER_RE.test(context) && ACTION_RE.test(context);
}

export function findApprovalTarget(candidates) {
  for (const candidate of candidates ?? []) {
    if (classifyButton(candidate) !== "positive") {
      continue;
    }

    if (!hasToolContext(candidate)) {
      continue;
    }

    return {
      ...candidate,
      text: normalizeText(candidate.text || candidate.title || candidate.ariaLabel),
      kind: "approval"
    };
  }

  return null;
}

export function classifyPageState(input) {
  const visibleText = normalizeText(input?.visibleText);
  const errorPattern = ERROR_TEXT.find((pattern) => includesAnyText(visibleText, [pattern]));
  if (errorPattern) {
    return {
      status: "chatgpt_error",
      reason: errorPattern
    };
  }

  if (input?.hasStopButton) {
    const startedAt = input.generationStartedAt;
    const now = Number(input.now ?? Date.now());
    const stuckThresholdMs = Number(input.stuckThresholdMs ?? 120000);

    if (typeof startedAt === "number" && now - startedAt >= stuckThresholdMs) {
      return {
        status: "stuck_generation",
        reason: `generation exceeded ${stuckThresholdMs}ms`
      };
    }

    return {
      status: "generating",
      reason: "generation control visible"
    };
  }

  return {
    status: "idle",
    reason: null
  };
}

export const matcherConstants = {
  POSITIVE_BUTTON_TEXT,
  NEGATIVE_BUTTON_TEXT,
  TOOL_CONTEXT_TEXT,
  ERROR_TEXT,
  ACTION_RE,
  DANGEROUS_CONTEXT_RE,
  PROVIDER_RE,
  TOOL_WORD_RE
};
