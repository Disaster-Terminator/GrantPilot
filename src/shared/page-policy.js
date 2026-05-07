export const REFRESH_INTERVAL_SEQUENCE_MS = Object.freeze([
  10000,
  15000,
  30000,
  60000,
  120000,
  300000
]);

export function classifyChatGptPage(urlValue) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return { supported: false, reason: "invalid_url" };
  }

  if (url.hostname !== "chatgpt.com" && url.hostname !== "chat.openai.com") {
    return { supported: false, reason: "unsupported_host" };
  }

  const path = url.pathname.replace(/\/+$/, "");
  if (/^\/c\/[^/]+$/.test(path) || /^\/g\/[^/]+\/c\/[^/]+$/.test(path)) {
    return { supported: true, reason: "conversation" };
  }

  return { supported: false, reason: "not_conversation_page" };
}

export function getRefreshIntervalMs(refreshCount) {
  const index = Math.max(0, Math.min(Number(refreshCount) || 0, REFRESH_INTERVAL_SEQUENCE_MS.length - 1));
  return REFRESH_INTERVAL_SEQUENCE_MS[index];
}

export function shouldRefreshNow(input) {
  if (!input?.enabled || !input.autoRefresh) {
    return { refresh: false, reason: "disabled" };
  }

  const page = classifyChatGptPage(input.url);
  if (!page.supported) {
    return { refresh: false, reason: page.reason };
  }

  if (input.hasApprovalTarget) {
    return { refresh: false, reason: "approval_target_present" };
  }

  if (input.pageStatus === "generating" || input.pageStatus === "chatgpt_error") {
    return { refresh: false, reason: input.pageStatus };
  }

  const intervalMs = getRefreshIntervalMs(input.refreshCount);
  const elapsedMs = Math.max(0, Number(input.now) - Number(input.lastActivityAt));
  if (elapsedMs < intervalMs) {
    return { refresh: false, reason: "waiting", intervalMs, remainingMs: intervalMs - elapsedMs };
  }

  return { refresh: true, reason: input.pageStatus || "idle", intervalMs };
}
