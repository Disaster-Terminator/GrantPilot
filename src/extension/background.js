const DEFAULT_SETTINGS = {
  enabled: false,
  autoRefresh: false,
  refreshIntervalMs: 20000,
  scanIntervalMs: 1000,
  stuckThresholdMs: 120000,
  logToLocalServer: false,
  debugServerUrl: "http://127.0.0.1:17762/events"
};

const MAX_EVENTS = 200;
const REFRESH_INTERVALS = [10000, 20000, 30000];
const REFRESH_ALARM_PREFIX = "grantpilot-refresh:";

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSettings();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void syncTabBadge(tabId, tab);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabSettings(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(REFRESH_ALARM_PREFIX)) {
    void handleRefreshAlarm(alarm.name);
  }
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
    case "GRANTPILOT_GET_CONTENT_SETTINGS":
      return getSettingsForSender(sender);
    case "GRANTPILOT_UPDATE_SETTINGS":
      return updateSettings(message.patch || {});
    case "GRANTPILOT_EVENT":
      return recordEvent(message.event || {}, sender);
    default:
      throw new Error(`unknown_message:${message?.type || "missing"}`);
  }
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(["tabSettings", "events"]);
  if (!stored.tabSettings) {
    await chrome.storage.local.set({ tabSettings: {} });
  }
  if (!stored.events) {
    await chrome.storage.local.set({ events: [] });
  }
}

async function readTabSettings(tab) {
  await ensureSettings();
  const tabId = tab?.id;
  const pageKey = getPageKey(tab?.url);
  if (!Number.isInteger(tabId) || !pageKey) {
    return { settings: DEFAULT_SETTINGS, pageKey: null, tabId: null };
  }

  const { tabSettings = {} } = await chrome.storage.local.get("tabSettings");
  const stored = tabSettings[String(tabId)];
  if (!stored || stored.pageKey !== pageKey) {
    return { settings: DEFAULT_SETTINGS, pageKey, tabId };
  }

  return {
    settings: {
      ...DEFAULT_SETTINGS,
      ...(stored.settings || {})
    },
    pageKey,
    tabId
  };
}

async function updateSettings(patch) {
  const tab = await getActiveTab();
  const current = await readTabSettings(tab);
  if (!current.tabId || !current.pageKey) {
    throw new Error("active_tab_not_supported");
  }
  const next = {
    ...current.settings,
    ...sanitizeSettingsPatch(patch)
  };
  const { tabSettings = {} } = await chrome.storage.local.get("tabSettings");
  tabSettings[String(current.tabId)] = {
    pageKey: current.pageKey,
    settings: next,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ tabSettings });
  if (!next.enabled || !next.autoRefresh) {
    await clearRefreshAlarm(current.tabId);
  }
  await updateBadge(next, null, current.tabId);
  return next;
}

function sanitizeSettingsPatch(patch) {
  const sanitized = {};
  if (typeof patch.enabled === "boolean") sanitized.enabled = patch.enabled;
  if (typeof patch.autoRefresh === "boolean") sanitized.autoRefresh = patch.autoRefresh;
  if (typeof patch.logToLocalServer === "boolean") sanitized.logToLocalServer = patch.logToLocalServer;
  if (typeof patch.refreshIntervalMs === "number" && REFRESH_INTERVALS.includes(patch.refreshIntervalMs)) {
    sanitized.refreshIntervalMs = patch.refreshIntervalMs;
  }
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
  const tab = await getActiveTab();
  const current = await readTabSettings(tab);
  const lastIssue = [...events].reverse().find((event) =>
    event.kind === "chatgpt_error" || event.kind === "stuck_generation" || event.kind === "runtime_error"
  ) || null;
  return {
    settings: current.settings,
    currentTab: {
      id: current.tabId,
      url: tab?.url ?? null,
      pageKey: current.pageKey,
      supported: Boolean(current.pageKey)
    },
    events,
    lastIssue
  };
}

async function getSettingsForSender(sender) {
  const current = await readTabSettings(sender?.tab);
  return {
    settings: current.settings,
    pageKey: current.pageKey,
    tabId: current.tabId
  };
}

async function recordEvent(event, sender) {
  const current = await readTabSettings(sender?.tab);
  const settings = current.settings;
  const entry = {
    ...event,
    at: new Date().toISOString(),
    tabId: sender?.tab?.id ?? null,
    url: sender?.tab?.url ?? null
  };
  const { events = [] } = await chrome.storage.local.get("events");
  const nextEvents = [...events, entry].slice(-MAX_EVENTS);
  await chrome.storage.local.set({ events: nextEvents });
  await syncRefreshAlarmFromEvent(entry, current, settings);
  await updateBadge(settings, entry, sender?.tab?.id);

  if (settings.logToLocalServer) {
    void fetch(settings.debugServerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(() => undefined);
  }

  return entry;
}

async function syncRefreshAlarmFromEvent(entry, current, settings) {
  const tabId = entry.tabId;
  if (!Number.isInteger(tabId) || !current.pageKey) {
    return;
  }

  if (entry.kind === "refresh_armed") {
    if (!settings.enabled || !settings.autoRefresh) {
      await clearRefreshAlarm(tabId);
      return;
    }
    const nextRefreshAt = Number(entry.detail?.nextRefreshAt);
    if (!Number.isFinite(nextRefreshAt)) {
      await clearRefreshAlarm(tabId);
      return;
    }
    const { refreshAlarms = {} } = await chrome.storage.local.get("refreshAlarms");
    refreshAlarms[String(tabId)] = {
      tabId,
      pageKey: current.pageKey,
      reason: entry.detail?.reason || "unknown",
      baseIntervalMs: entry.detail?.baseIntervalMs ?? null,
      jitteredDelayMs: entry.detail?.jitteredDelayMs ?? null,
      nextRefreshAt,
      armedAt: entry.at
    };
    await chrome.storage.local.set({ refreshAlarms });
    await chrome.alarms.create(getRefreshAlarmName(tabId), { when: nextRefreshAt });
    return;
  }

  if (entry.kind === "refresh_disarmed" || entry.kind === "page_refresh") {
    await clearRefreshAlarm(tabId);
  }
}

async function handleRefreshAlarm(alarmName) {
  const tabId = parseRefreshAlarmName(alarmName);
  if (!Number.isInteger(tabId)) {
    return;
  }

  const { refreshAlarms = {} } = await chrome.storage.local.get("refreshAlarms");
  const armed = refreshAlarms[String(tabId)];
  if (!armed) {
    return;
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const current = await readTabSettings(tab);
  const now = Date.now();
  if (
    !tab?.url ||
    current.pageKey !== armed.pageKey ||
    !current.settings.enabled ||
    !current.settings.autoRefresh ||
    getPageKey(tab.url) !== armed.pageKey ||
    !Number.isFinite(Number(armed.nextRefreshAt)) ||
    now < Number(armed.nextRefreshAt)
  ) {
    await clearRefreshAlarm(tabId);
    return;
  }

  const liveStatus = await getLivePageStatus(tabId);
  if (liveStatus?.hasApprovalTarget) {
    await rescheduleRefreshAlarm(tabId, armed, current.settings);
    return;
  }
  const pageStatus = liveStatus?.pageState?.status;
  if (pageStatus === "generating") {
    await rescheduleRefreshAlarm(tabId, armed, current.settings);
    return;
  }
  if (pageStatus === "idle" || pageStatus === "chatgpt_error") {
    await clearRefreshAlarm(tabId);
    return;
  }

  await clearRefreshAlarm(tabId);
  await recordBackgroundEvent({
    kind: "page_refresh",
    detail: {
      reason: "background_alarm",
      armedReason: armed.reason,
      baseIntervalMs: armed.baseIntervalMs,
      jitteredDelayMs: armed.jitteredDelayMs,
      nextRefreshAt: armed.nextRefreshAt
    }
  }, tab);
  await chrome.tabs.reload(tabId);
}

async function getLivePageStatus(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "GRANTPILOT_GET_PAGE_STATUS" });
    if (!response?.ok) {
      return null;
    }
    return response.result || null;
  } catch {
    return null;
  }
}

async function rescheduleRefreshAlarm(tabId, armed, settings) {
  const delayMs = normalizeRefreshIntervalMs(settings.refreshIntervalMs);
  const nextRefreshAt = Date.now() + delayMs;
  const { refreshAlarms = {} } = await chrome.storage.local.get("refreshAlarms");
  refreshAlarms[String(tabId)] = {
    ...armed,
    nextRefreshAt,
    rescheduledAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ refreshAlarms });
  await chrome.alarms.create(getRefreshAlarmName(tabId), { when: nextRefreshAt });
}

async function recordBackgroundEvent(event, tab) {
  const current = await readTabSettings(tab);
  const entry = {
    ...event,
    at: new Date().toISOString(),
    tabId: tab?.id ?? null,
    url: tab?.url ?? null
  };
  const { events = [] } = await chrome.storage.local.get("events");
  const nextEvents = [...events, entry].slice(-MAX_EVENTS);
  await chrome.storage.local.set({ events: nextEvents });
  await updateBadge(current.settings, entry, tab?.id);
  if (current.settings.logToLocalServer) {
    void fetch(current.settings.debugServerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(() => undefined);
  }
  return entry;
}

async function syncTabBadge(tabId, tab) {
  const current = await readTabSettings({ id: tabId, url: tab?.url });
  if (!current.pageKey) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  await updateBadge(current.settings, null, tabId);
}

async function removeTabSettings(tabId) {
  const { tabSettings = {} } = await chrome.storage.local.get("tabSettings");
  if (tabSettings[String(tabId)]) {
    delete tabSettings[String(tabId)];
    await chrome.storage.local.set({ tabSettings });
  }
  await clearRefreshAlarm(tabId);
}

async function updateBadge(settings, latestEvent = null, tabId = null) {
  const target = Number.isInteger(tabId) ? { tabId } : {};
  if (latestEvent?.kind === "chatgpt_error" || latestEvent?.kind === "stuck_generation") {
    await chrome.action.setBadgeText({ ...target, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ ...target, color: "#b42318" });
    return;
  }

  await chrome.action.setBadgeText({ ...target, text: settings.enabled ? "ON" : "" });
  if (settings.enabled) {
    await chrome.action.setBadgeBackgroundColor({ ...target, color: "#1677ff" });
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function getPageKey(urlValue) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    return null;
  }
  if (url.hostname !== "chatgpt.com" && url.hostname !== "chat.openai.com") {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (/^\/c\/[^/]+$/.test(path) || /^\/g\/[^/]+\/c\/[^/]+$/.test(path)) {
    return `${url.origin}${path}`;
  }
  return null;
}

function normalizeRefreshIntervalMs(value) {
  const interval = Number(value);
  return REFRESH_INTERVALS.includes(interval) ? interval : 20000;
}

function getRefreshAlarmName(tabId) {
  return `${REFRESH_ALARM_PREFIX}${tabId}`;
}

function parseRefreshAlarmName(name) {
  if (!name.startsWith(REFRESH_ALARM_PREFIX)) {
    return null;
  }
  const tabId = Number(name.slice(REFRESH_ALARM_PREFIX.length));
  return Number.isInteger(tabId) ? tabId : null;
}

async function clearRefreshAlarm(tabId) {
  const { refreshAlarms = {} } = await chrome.storage.local.get("refreshAlarms");
  if (refreshAlarms[String(tabId)]) {
    delete refreshAlarms[String(tabId)];
    await chrome.storage.local.set({ refreshAlarms });
  }
  await chrome.alarms.clear(getRefreshAlarmName(tabId));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
