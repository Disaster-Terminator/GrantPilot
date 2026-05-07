const DEFAULT_SETTINGS = {
  enabled: false,
  autoRefresh: false,
  scanIntervalMs: 1000,
  stuckThresholdMs: 120000,
  logToLocalServer: false,
  debugServerUrl: "http://127.0.0.1:17762/events"
};

const MAX_EVENTS = 200;

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "GRANTPILOT_GET_MODEL":
      return getPopupModel();
    case "GRANTPILOT_UPDATE_SETTINGS":
      return updateSettings(message.patch || {});
    case "GRANTPILOT_EVENT":
      return recordEvent(message.event || {}, sender);
    default:
      throw new Error(`unknown_message:${message?.type || "missing"}`);
  }
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(["settings", "events"]);
  if (!stored.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  if (!stored.events) {
    await chrome.storage.local.set({ events: [] });
  }
}

async function readSettings() {
  await ensureSettings();
  const stored = await chrome.storage.local.get("settings");
  return {
    ...DEFAULT_SETTINGS,
    ...(stored.settings || {})
  };
}

async function updateSettings(patch) {
  const next = {
    ...(await readSettings()),
    ...sanitizeSettingsPatch(patch)
  };
  await chrome.storage.local.set({ settings: next });
  await updateBadge(next);
  return next;
}

function sanitizeSettingsPatch(patch) {
  const sanitized = {};
  if (typeof patch.enabled === "boolean") sanitized.enabled = patch.enabled;
  if (typeof patch.autoRefresh === "boolean") sanitized.autoRefresh = patch.autoRefresh;
  if (typeof patch.logToLocalServer === "boolean") sanitized.logToLocalServer = patch.logToLocalServer;
  if (typeof patch.scanIntervalMs === "number") {
    sanitized.scanIntervalMs = clamp(patch.scanIntervalMs, 500, 10000);
  }
  if (typeof patch.stuckThresholdMs === "number") {
    sanitized.stuckThresholdMs = clamp(patch.stuckThresholdMs, 30000, 600000);
  }
  return sanitized;
}

async function getPopupModel() {
  const { events = [] } = await chrome.storage.local.get("events");
  const settings = await readSettings();
  const lastIssue = [...events].reverse().find((event) =>
    event.kind === "chatgpt_error" || event.kind === "stuck_generation" || event.kind === "runtime_error"
  ) || null;
  return {
    settings,
    events,
    lastIssue
  };
}

async function recordEvent(event, sender) {
  const settings = await readSettings();
  const entry = {
    ...event,
    at: new Date().toISOString(),
    tabId: sender?.tab?.id ?? null,
    url: sender?.tab?.url ?? null
  };
  const { events = [] } = await chrome.storage.local.get("events");
  const nextEvents = [...events, entry].slice(-MAX_EVENTS);
  await chrome.storage.local.set({ events: nextEvents });
  await updateBadge(settings, entry);

  if (settings.logToLocalServer) {
    void fetch(settings.debugServerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(() => undefined);
  }

  return entry;
}

async function updateBadge(settings, latestEvent = null) {
  if (latestEvent?.kind === "chatgpt_error" || latestEvent?.kind === "stuck_generation") {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#b42318" });
    return;
  }

  await chrome.action.setBadgeText({ text: settings.enabled ? "ON" : "" });
  if (settings.enabled) {
    await chrome.action.setBadgeBackgroundColor({ color: "#1677ff" });
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
