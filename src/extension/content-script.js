(() => {
  const DEFAULT_SETTINGS = {
    enabled: false,
    autoRefresh: false,
    refreshIntervalMs: 300000,
    scanIntervalMs: 1000,
    stuckThresholdMs: 120000
  };

  const POSITIVE = ["确认", "允许", "批准", "继续", "Confirm", "Allow", "Approve", "Continue"];
  const NEGATIVE = ["拒绝", "取消", "Deny", "Reject", "Cancel"];
  const CONTEXT = [
    "使用工具存在风险",
    "Received app response",
    "app response",
    "GitHub",
    "tool",
    "connector",
    "app",
    "MCP",
    "工具",
    "连接器",
    "应用"
  ];
  const ERRORS = [
    "Something went wrong",
    "There was an error",
    "An error occurred",
    "Unable to generate",
    "Network error",
    "message stream interrupted",
    "出了点问题",
    "发生错误",
    "网络错误",
    "无法生成"
  ];
  const MOJIBAKE = new Map([
    ["纭", "确认"],
    ["鎷掔粷", "拒绝"],
    ["鍙栨秷", "取消"],
    ["鍏佽", "允许"],
    ["鎵瑰噯", "批准"],
    ["缁х画", "继续"]
  ]);

  let settings = { ...DEFAULT_SETTINGS };
  let scanTimer = null;
  let observer = null;
  let lastClickedAt = 0;
  let lastReloadAt = Date.now();
  let generationStartedAt = null;
  let lastIssueKey = null;

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
      const target = findApprovalTarget();
      const pageState = classifyPageState();

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
          target.button.click();
          await report("approval_clicked", {
            source,
            text: target.text,
            contextPreview: target.contextText.slice(0, 180)
          });
        }
        return;
      }

      maybeAutoRefresh(pageState);
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
      document.querySelector('button[aria-label*="停止"]')
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

  function maybeAutoRefresh(pageState) {
    if (
      !settings.autoRefresh ||
      pageState.status === "generating" ||
      pageState.status === "chatgpt_error"
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastReloadAt < settings.refreshIntervalMs) {
      return;
    }

    lastReloadAt = now;
    void report("page_refresh", {
      reason: pageState.status,
      intervalMs: settings.refreshIntervalMs
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
