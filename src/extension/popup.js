const elements = {
  status: document.querySelector("#status"),
  enabled: document.querySelector("#enabled"),
  autoRefresh: document.querySelector("#autoRefresh"),
  refreshIntervalMs: document.querySelector("#refreshIntervalMs"),
  logToLocalServer: document.querySelector("#logToLocalServer"),
  lastIssue: document.querySelector("#lastIssue"),
  events: document.querySelector("#events")
};

let model = null;

void refresh();
window.setInterval(() => {
  void refresh();
}, 1500);

elements.enabled.addEventListener("change", () => {
  void updateSettings({ enabled: elements.enabled.checked });
});

elements.autoRefresh.addEventListener("change", () => {
  void updateSettings({ autoRefresh: elements.autoRefresh.checked });
});

elements.refreshIntervalMs.addEventListener("change", () => {
  void updateSettings({ refreshIntervalMs: Number(elements.refreshIntervalMs.value) });
});

elements.logToLocalServer.addEventListener("change", () => {
  void updateSettings({ logToLocalServer: elements.logToLocalServer.checked });
});

async function refresh() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GRANTPILOT_GET_MODEL" });
    if (!response.ok) {
      throw new Error(response.error || "popup_model_failed");
    }
    model = response.result;
    render(model);
  } catch (error) {
    elements.status.textContent = "Error";
    elements.status.classList.remove("enabled");
    elements.lastIssue.textContent = error instanceof Error ? error.message : String(error);
  }
}

async function updateSettings(patch) {
  const response = await chrome.runtime.sendMessage({
    type: "GRANTPILOT_UPDATE_SETTINGS",
    patch
  });
  if (!response.ok) {
    throw new Error(response.error || "settings_update_failed");
  }
  await refresh();
}

function render(nextModel) {
  const settings = nextModel.settings;
  elements.status.textContent = settings.enabled ? "Enabled" : "Disabled";
  elements.status.classList.toggle("enabled", settings.enabled);
  elements.enabled.checked = settings.enabled;
  elements.autoRefresh.checked = settings.autoRefresh;
  elements.refreshIntervalMs.value = String(settings.refreshIntervalMs || 20000);
  elements.logToLocalServer.checked = settings.logToLocalServer;

  if (nextModel.lastIssue) {
    const detail = nextModel.lastIssue.detail || {};
    elements.lastIssue.textContent = detail.reason || detail.error || nextModel.lastIssue.kind;
  } else {
    elements.lastIssue.textContent = "None";
  }

  const recent = [...(nextModel.events || [])].reverse().slice(0, 8);
  elements.events.replaceChildren(...recent.map(renderEvent));
}

function renderEvent(event) {
  const item = document.createElement("li");
  const detail = event.detail || {};
  const message = detail.reason || detail.error || detail.text || "";
  item.textContent = `${event.kind}${message ? `: ${message}` : ""}`;
  item.title = `${event.at || ""} ${event.url || ""}`;
  return item;
}
