export const REFRESH_INTERVAL_OPTIONS_MS = Object.freeze([10000, 20000, 30000]);
export const DEFAULT_REFRESH_INTERVAL_MS = 20000;
export const JITTER_MIN_RATIO = 0.85;
export const JITTER_MAX_RATIO = 1.2;

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

export function normalizeRefreshIntervalMs(value) {
  const interval = Number(value);
  return REFRESH_INTERVAL_OPTIONS_MS.includes(interval) ? interval : DEFAULT_REFRESH_INTERVAL_MS;
}

export function computeJitteredRefreshIntervalMs(baseIntervalMs, randomValue = Math.random()) {
  const base = normalizeRefreshIntervalMs(baseIntervalMs);
  const normalizedRandom = Math.min(1, Math.max(0, Number(randomValue) || 0));
  const ratio = JITTER_MIN_RATIO + (JITTER_MAX_RATIO - JITTER_MIN_RATIO) * normalizedRandom;
  return Math.round(base * ratio);
}

export function shouldRefreshNow(input) {
  if (!input?.enabled || !input.autoRefresh) {
    return { refresh: false, reason: "disabled" };
  }

  const page = classifyChatGptPage(input.url);
  if (!page.supported) {
    return { refresh: false, reason: page.reason };
  }

  if (input.pageStatus === "stuck_generation" && !input.hasApprovalTarget) {
    return { refresh: true, reason: "stuck_generation" };
  }

  if (!input.refreshArmed) {
    return { refresh: false, reason: "not_armed" };
  }

  if (input.hasApprovalTarget) {
    return { refresh: false, reason: "approval_target_present" };
  }

  if (input.pageStatus === "generating" || input.pageStatus === "chatgpt_error") {
    return { refresh: false, reason: input.pageStatus };
  }

  const nextRefreshAt = Number(input.nextRefreshAt);
  if (!Number.isFinite(nextRefreshAt)) {
    return { refresh: false, reason: "no_refresh_deadline" };
  }

  const now = Number(input.now);
  if (now < nextRefreshAt) {
    return { refresh: false, reason: "waiting", remainingMs: nextRefreshAt - now };
  }

  return { refresh: true, reason: input.pageStatus || "idle" };
}

export function getChatGptPageKey(urlValue) {
  const page = classifyChatGptPage(urlValue);
  if (!page.supported) {
    return null;
  }
  const url = new URL(urlValue);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
