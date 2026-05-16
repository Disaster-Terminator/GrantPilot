import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadBackground(initialStorage = {}, options = {}) {
  const storage = structuredClone(initialStorage);
  let messageListener = null;
  let alarmListener = null;
  const alarms = new Map();
  const reloads = [];
  const tabs = new Map([[42, { id: 42, url: "https://chatgpt.com/c/test" }]]);

  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    },
    tabs: {
      onUpdated: { addListener() {} },
      onRemoved: { addListener() {} },
      async query() {
        return [tabs.get(42)];
      },
      async get(tabId) {
        return tabs.get(tabId);
      },
      async reload(tabId) {
        reloads.push(tabId);
      },
      async sendMessage() {
        if (options.liveStatus instanceof Error) {
          throw options.liveStatus;
        }
        return options.liveStatus ?? null;
      }
    },
    storage: {
      local: {
        async get(keys) {
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          if (typeof keys === "string") {
            return { [keys]: storage[keys] };
          }
          return { ...storage };
        },
        async set(patch) {
          Object.assign(storage, structuredClone(patch));
        }
      }
    },
    alarms: {
      onAlarm: {
        addListener(listener) {
          alarmListener = listener;
        }
      },
      async create(name, alarm) {
        alarms.set(name, alarm);
      },
      async clear(name) {
        alarms.delete(name);
      }
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {}
    }
  };

  vm.runInNewContext(readFileSync("src/extension/background.js", "utf8"), {
    chrome,
    Date,
    Error,
    fetch: async () => undefined,
    URL
  }, {
    filename: "src/extension/background.js"
  });

  async function sendMessage(message, sender = { tab: tabs.get(42) }) {
    return new Promise((resolve) => {
      messageListener(message, sender, resolve);
    });
  }

  return {
    alarms,
    chrome,
    reloads,
    storage,
    async sendMessage(message, sender) {
      const response = await sendMessage(message, sender);
      assert.equal(response.ok, true, response.error);
      return response.result;
    },
    async fireAlarm(name) {
      alarmListener({ name });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
}

test("background creates a fallback alarm for refresh_armed and reloads matching tab", async () => {
  const pageKey = "https://chatgpt.com/c/test";
  const app = loadBackground({
    tabSettings: {
      "42": {
        pageKey,
        settings: {
          enabled: true,
          autoRefresh: true,
          refreshIntervalMs: 10000
        }
      }
    },
    events: []
  });

  const nextRefreshAt = Date.now() - 1;
  await app.sendMessage({
    type: "GRANTPILOT_EVENT",
    event: {
      kind: "refresh_armed",
      detail: {
        reason: "approval_clicked",
        baseIntervalMs: 10000,
        jitteredDelayMs: 10000,
        nextRefreshAt
      }
    }
  });

  assert.deepEqual([...app.alarms.keys()], ["grantpilot-refresh:42"]);
  await app.fireAlarm("grantpilot-refresh:42");

  assert.equal(app.reloads.length, 1);
  assert.equal(app.reloads[0], 42);
  assert.equal(app.storage.refreshAlarms["42"], undefined);
  const refreshEvent = app.storage.events.find((event) => event.kind === "page_refresh");
  assert.equal(refreshEvent?.detail.reason, "background_alarm");
  assert.equal(refreshEvent?.detail.armedReason, "approval_clicked");
});

test("background clears fallback alarm when refresh is disarmed", async () => {
  const pageKey = "https://chatgpt.com/c/test";
  const app = loadBackground({
    tabSettings: {
      "42": {
        pageKey,
        settings: {
          enabled: true,
          autoRefresh: true
        }
      }
    },
    refreshAlarms: {
      "42": {
        tabId: 42,
        pageKey,
        nextRefreshAt: Date.now() + 10000
      }
    },
    events: []
  });
  app.alarms.set("grantpilot-refresh:42", { when: Date.now() + 10000 });

  await app.sendMessage({
    type: "GRANTPILOT_EVENT",
    event: {
      kind: "refresh_disarmed",
      detail: { reason: "generation_settled" }
    }
  });

  assert.deepEqual([...app.alarms.keys()], []);
  assert.equal(app.storage.refreshAlarms["42"], undefined);
});

test("background reschedules instead of reloading while content script reports active generation", async () => {
  const pageKey = "https://chatgpt.com/c/test";
  const app = loadBackground({
    tabSettings: {
      "42": {
        pageKey,
        settings: {
          enabled: true,
          autoRefresh: true,
          refreshIntervalMs: 10000
        }
      }
    },
    refreshAlarms: {
      "42": {
        tabId: 42,
        pageKey,
        reason: "generation_in_progress",
        baseIntervalMs: 10000,
        jitteredDelayMs: 9000,
        nextRefreshAt: Date.now() - 1
      }
    },
    events: []
  }, {
    liveStatus: {
      ok: true,
      result: {
        hasApprovalTarget: false,
        pageState: {
          status: "generating",
          reason: "generation control visible"
        }
      }
    }
  });

  await app.fireAlarm("grantpilot-refresh:42");

  assert.equal(app.reloads.length, 0);
  assert.equal(app.storage.events.some((event) => event.kind === "page_refresh"), false);
  assert.equal(app.storage.refreshAlarms["42"].reason, "generation_in_progress");
  assert.ok(app.storage.refreshAlarms["42"].nextRefreshAt > Date.now());
});

test("background reschedules generation fallback when live page status is unavailable", async () => {
  const pageKey = "https://chatgpt.com/c/test";
  const app = loadBackground({
    tabSettings: {
      "42": {
        pageKey,
        settings: {
          enabled: true,
          autoRefresh: true,
          refreshIntervalMs: 10000
        }
      }
    },
    refreshAlarms: {
      "42": {
        tabId: 42,
        pageKey,
        reason: "generation_in_progress",
        baseIntervalMs: 10000,
        jitteredDelayMs: 9000,
        nextRefreshAt: Date.now() - 1
      }
    },
    events: []
  }, {
    liveStatus: new Error("Receiving end does not exist")
  });

  await app.fireAlarm("grantpilot-refresh:42");

  assert.equal(app.reloads.length, 0);
  assert.equal(app.storage.events.some((event) => event.kind === "page_refresh"), false);
  assert.equal(app.storage.refreshAlarms["42"].reason, "generation_in_progress");
  assert.ok(app.storage.refreshAlarms["42"].nextRefreshAt > Date.now());
});
