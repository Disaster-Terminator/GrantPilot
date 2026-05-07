(() => {
  const DEFAULT_SETTINGS = {
    enabled: false,
    autoRefresh: false,
    refreshIntervalMs: 20000,
    scanIntervalMs: 1000,
    stuckThresholdMs: 120000
  };

  const REFRESH_INTERVAL_OPTIONS_MS = [10000, 20000, 30000];
  const JITTER_MIN_RATIO = 0.85;
  const JITTER_MAX_RATIO = 1.2;
  const POSITIVE = ["\u786e\u8ba4", "\u5141\u8bb8", "\u6279\u51c6", "\u7ee7\u7eed", "Confirm", "Allow", "Approve", "Continue"];
  const NEGATIVE = ["\u62d2\u7edd", "\u53d6\u6d88", "Deny", "Reject", "Cancel"];
  const CONTEXT = [
    "\u4f7f\u7528\u5de5\u5177\u5b58\u5728\u98ce\u9669",
    "Received app response",
    "app response",
    "GitHub",
    "tool",
    "connector",
    "app",
    "MCP",
    "\u5de5\u5177",
    "\u8fde\u63a5\u5668",
    "\u5e94\u7528"
  ];
  const ERRORS = [
    "Something went wrong",
    "There was an error",
    "An error occurred",
    "Unable to generate",
    "Network error",
    "message stream interrupted",
    "\u51fa\u4e86\u70b9\u95ee\u9898",
    "\u53d1\u751f\u9519\u8bef",
    "\u7f51\u7edc\u9519\u8bef",
    "\u65e0\u6cd5\u751f\u6210"
  ];
  const MOJIBAKE = new Map([
    ["\u7ea4\ue758\u559b\u9853?", "\u786e\u8ba4"],
    ["\u95b9\u950b\u5e1e\u7eee?", "\u62d2\u7edd"],
    ["\u95b8\u6b04\u7257\u7ec9?", "\u53d6\u6d88"],
    ["\u95b8\u5fd0\u4d47\u9854?", "\u5141\u8bb8"],
    ["\u95b9\u7535\u61d3\u9363?", "\u6279\u51c6"],
    ["\u7f02\u4f48\u5470\u657e", "\u7ee7\u7eed"],
    ["\u7ea4\u786e\u8ba4", "\u786e\u8ba4"],
    ["\u7ebe\u786e\u8ba4", "\u786e\u8ba4"]
  ]);

  let settings = { ...DEFAULT_SETTINGS };
  let scanTimer = null;
  let observer = null;
  let lastClickedAt = 0;
  let refreshArmed = false;
  let nextRefreshAt = null;
  let currentRefreshDelayMs = null;
  let generationStartedAt = null;
  let lastIssueKey = null;
  let lastUrl = location.href;
  let lastConversationSignature = null;

  void start();

  async function start() {
    settings = await readSettings();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.settings?.newValue) {
        settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
        schedule();
      }
    });
    schedule();
  }

  async function readSettings() {
    const stored = await chrome.storage.local.get("settings");
    return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  }

  function schedule() {
    if (scanTimer !== null) {
      window.clearInterval(scanTimer);
      scanTimer = null;
    }
    observer?.disconnect();
    observer = null;

    if (!settings.enabled) {
      hideIssue();
      return;
    }

    scanTimer = window.setInterval(() => {
      void scan("interval");
    }, settings.scanIntervalMs);

    observer = new MutationObserver(() => {
      void scan("mutation");
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    void scan("start");
  }

  async function scan(source) {
    if (!settings.enabled) {
      return;
    }

    try {
      syncUrlState();
      if (!classifyChatGptPage(location.href).supported) {
        hideIssue();
        return;
      }

      const target = findApprovalTarget();
      const pageState = classifyPageState();
      const activity = detectConversationActivity(Boolean(target), pageState);

      if (pageState.status === "chatgpt_error" || pageState.status === "stuck_generation") {
        showIssue(pageState.reason);
        await report(pageState.status, { source, reason: pageState.reason });
      } else {
        hideIssue();
      }

      if (target) {
        const now = Date.now();
        if (now - lastClickedAt > 1500) {
          lastClickedAt = now;
          armRefresh("approval_clicked");
          target.button.click();
          await report("approval_clicked", {
            source,
            text: target.text,
            contextPreview: target.contextText.slice(0, 180)
          });
        }
        return;
      }

      if (activity.active) {
        armRefresh(activity.reason);
      }

      maybeAutoRefresh(pageState, Boolean(target));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showIssue(message);
      await report("runtime_error", { source, error: message });
    }
  }

  function findApprovalTarget() {
    const candidates = Array.from(document.querySelectorAll("button,[role='button']"));
    for (const button of candidates) {
      const info = describeButton(button);
      if (info.kind !== "positive" || !hasToolContext(info.contextText)) {
        continue;
      }
      return {
        button,
        text: info.text,
        contextText: info.contextText
      };
    }
    return null;
  }

  function describeButton(button) {
    const text = normalizeText([
      button.textContent,
      button.getAttribute("title"),
      button.getAttribute("aria-label")
    ].filter(Boolean).join(" "));
    const disabled = button.disabled || button.getAttribute("aria-disabled") === "true";
    const rect = button.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0;
    const contextText = findContextText(button);

    if (!text || disabled || !visible) {
      return { kind: "irrelevant", text, contextText };
    }
    if (containsAny(text, NEGATIVE)) {
      return { kind: "negative", text, contextText };
    }
    if (containsAny(text, POSITIVE)) {
      return { kind: "positive", text, contextText };
    }
    return { kind: "irrelevant", text, contextText };
  }

  function hasToolContext(text) {
    return containsAny(text, CONTEXT);
  }

  function findContextText(button) {
    let current = button;
    let fallback = "";

    for (let depth = 0; current && depth < 10; depth += 1) {
      const text = normalizeText(current.textContent || "");
      if (text && text.length > fallback.length && text.length <= 5000) {
        fallback = text;
      }
      if (hasToolContext(text)) {
        return text;
      }
      current = current.parentElement;
    }

    const dialog = button.closest("[role='dialog']");
    const dialogText = normalizeText(dialog?.textContent || "");
    if (hasToolContext(dialogText)) {
      return dialogText;
    }

    return fallback;
  }

  function classifyPageState() {
    const visibleText = normalizeText(document.body?.innerText || document.body?.textContent || "");
    const errorPattern = ERRORS.find((pattern) => containsAny(visibleText, [pattern]));
    if (errorPattern) {
      return {
        status: "chatgpt_error",
        reason: errorPattern
      };
    }

    const hasStopButton = Boolean(
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('button[data-testid="stop-generating-button"]') ||
      document.querySelector('button[aria-label*="Stop"]') ||
      document.querySelector('button[aria-label*="Cancel"]') ||
      document.querySelector('button[aria-label*="\u505c\u6b62"]')
    );

    if (!hasStopButton) {
      generationStartedAt = null;
      return { status: "idle", reason: null };
    }

    generationStartedAt ??= Date.now();
    if (Date.now() - generationStartedAt >= settings.stuckThresholdMs) {
      return {
        status: "stuck_generation",
        reason: `ChatGPT generation exceeded ${Math.round(settings.stuckThresholdMs / 1000)}s`
      };
    }

    return { status: "generating", reason: "generation control visible" };
  }

  function maybeAutoRefresh(pageState, hasApprovalTarget) {
    const decision = shouldRefreshNow({
      enabled: settings.enabled,
      autoRefresh: settings.autoRefresh,
      url: location.href,
      pageStatus: pageState.status,
      hasApprovalTarget,
      refreshArmed,
      nextRefreshAt,
      now: Date.now(),
    });

    if (!decision.refresh) {
      return;
    }

    refreshArmed = false;
    const usedDelayMs = currentRefreshDelayMs;
    void report("page_refresh", {
      reason: decision.reason,
      baseIntervalMs: normalizeRefreshIntervalMs(settings.refreshIntervalMs),
      jitteredDelayMs: usedDelayMs,
      nextRefreshAt
    });
    window.location.reload();
  }

  async function report(kind, detail) {
    const key = `${kind}:${detail?.reason || detail?.error || detail?.text || ""}`;
    if ((kind === "chatgpt_error" || kind === "stuck_generation") && key === lastIssueKey) {
      return;
    }
    if (kind === "chatgpt_error" || kind === "stuck_generation") {
      lastIssueKey = key;
    }
    await chrome.runtime.sendMessage({
      type: "GRANTPILOT_EVENT",
      event: { kind, detail }
    });
  }

  function shouldRefreshNow(input) {
    if (!input.enabled || !input.autoRefresh) {
      return { refresh: false, reason: "disabled" };
    }

    const page = classifyChatGptPage(input.url);
    if (!page.supported) {
      return { refresh: false, reason: page.reason };
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

    const deadline = Number(input.nextRefreshAt);
    if (!Number.isFinite(deadline)) {
      return { refresh: false, reason: "no_refresh_deadline" };
    }

    if (Number(input.now) < deadline) {
      return { refresh: false, reason: "waiting", remainingMs: deadline - Number(input.now) };
    }

    return { refresh: true, reason: input.pageStatus || "idle" };
  }

  function classifyChatGptPage(urlValue) {
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

  function normalizeRefreshIntervalMs(value) {
    const interval = Number(value);
    return REFRESH_INTERVAL_OPTIONS_MS.includes(interval) ? interval : 20000;
  }

  function computeJitteredRefreshIntervalMs(baseIntervalMs) {
    const base = normalizeRefreshIntervalMs(baseIntervalMs);
    const ratio = JITTER_MIN_RATIO + (JITTER_MAX_RATIO - JITTER_MIN_RATIO) * Math.random();
    return Math.round(base * ratio);
  }

  function armRefresh(reason) {
    if (!settings.autoRefresh || refreshArmed) {
      return;
    }
    currentRefreshDelayMs = computeJitteredRefreshIntervalMs(settings.refreshIntervalMs);
    nextRefreshAt = Date.now() + currentRefreshDelayMs;
    refreshArmed = true;
    void report("refresh_armed", {
      reason,
      baseIntervalMs: normalizeRefreshIntervalMs(settings.refreshIntervalMs),
      jitteredDelayMs: currentRefreshDelayMs,
      nextRefreshAt
    });
  }

  function syncUrlState() {
    if (lastUrl === location.href) {
      return;
    }
    lastUrl = location.href;
    refreshArmed = false;
    nextRefreshAt = null;
    currentRefreshDelayMs = null;
    generationStartedAt = null;
    lastIssueKey = null;
    lastConversationSignature = null;
  }

  function detectConversationActivity(hasApprovalTarget, pageState) {
    if (hasApprovalTarget) {
      return { active: true, reason: "approval_target_present" };
    }
    if (pageState.status === "generating") {
      return { active: true, reason: "generation_in_progress" };
    }
    const signature = readConversationSignature();
    if (lastConversationSignature === null) {
      lastConversationSignature = signature;
      return { active: false, reason: "baseline" };
    }
    if (signature && signature !== lastConversationSignature) {
      lastConversationSignature = signature;
      return { active: true, reason: "conversation_changed" };
    }
    return { active: false, reason: "unchanged" };
  }

  function readConversationSignature() {
    const turns = Array.from(document.querySelectorAll('[data-message-author-role="user"],[data-message-author-role="assistant"]'));
    const latest = turns.slice(-4).map((element) => normalizeText(element.textContent || "")).join("\n---\n");
    return hashText(latest);
  }

  function hashText(value) {
    const text = normalizeText(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16)}`;
  }

  function showIssue(message) {
    let element = document.getElementById("grantpilot-issue-banner");
    if (!element) {
      element = document.createElement("div");
      element.id = "grantpilot-issue-banner";
      element.style.cssText = [
        "position:fixed",
        "z-index:2147483647",
        "right:16px",
        "bottom:16px",
        "max-width:360px",
        "padding:10px 12px",
        "border-radius:8px",
        "background:#3b0a0a",
        "color:#fff",
        "font:13px/1.4 system-ui,sans-serif",
        "box-shadow:0 8px 30px rgba(0,0,0,.28)"
      ].join(";");
      document.documentElement.appendChild(element);
    }
    element.textContent = `GrantPilot: ${message}`;
  }

  function hideIssue() {
    document.getElementById("grantpilot-issue-banner")?.remove();
  }

  function containsAny(text, patterns) {
    const haystack = normalizeText(text).toLowerCase();
    return patterns.some((pattern) => haystack.includes(normalizeText(pattern).toLowerCase()));
  }

  function normalizeText(value) {
    let text = String(value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    for (const [bad, good] of MOJIBAKE) {
      text = text.split(bad).join(good);
    }
    return text;
  }
})();
