import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadContentScript(buttons = [], options = {}) {
  const document = createDocument(buttons, options);
  const events = [];
  const settings = {
    enabled: true,
    autoRefresh: false,
    ...(options.settings || {})
  };
  const sandbox = {
    __GRANTPILOT_TEST_MODE__: true,
    __GRANTPILOT_EXPOSE_INTERNALS__: true,
    console,
    Date,
    Math,
    URL,
    location: { href: options.url ?? "https://chatgpt.com/c/test" },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          if (message?.type === "GRANTPILOT_GET_CONTENT_SETTINGS") {
            return { ok: true, result: { settings } };
          }
          if (message?.type === "GRANTPILOT_EVENT") {
            events.push(message.event);
            return { ok: true, result: {} };
          }
          throw new Error(`unexpected_message:${message?.type}`);
        }
      },
      storage: {
        onChanged: { addListener() {} }
      }
    },
    document,
    window: {
      setInterval: () => 1,
      clearInterval: () => undefined,
      setTimeout: (fn) => {
        fn();
        return 1;
      },
      location: { reload() {} }
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync("src/extension/content-script.js", "utf8"), sandbox, {
    filename: "src/extension/content-script.js"
  });
  sandbox.__GrantPilotInternals.setSettingsForTest(settings);
  return Object.assign(sandbox.__GrantPilotInternals, { events });
}

function createDocument(buttons, options) {
  return {
    body: {
      innerText: options.bodyText ?? "",
      textContent: options.bodyText ?? ""
    },
    documentElement: new FakeElement({ text: "root" }),
    querySelectorAll(selector) {
      assert.equal(selector, "button,[role='button']");
      return buttons;
    },
    querySelector(selector) {
      return options.selectors?.has(selector) ? new FakeElement({ text: "stop" }) : null;
    },
    getElementById() {
      return null;
    },
    createElement() {
      return new FakeElement({ text: "" });
    }
  };
}

class FakeElement {
  constructor({ text, title = "", ariaLabel = "", disabled = false, visible = true, parent = null, role = "" }) {
    this.textContent = text;
    this.disabled = disabled;
    this.parentElement = parent;
    this.role = role;
    this.clicked = 0;
    this.attributes = new Map([
      ["title", title],
      ["aria-label", ariaLabel],
      ["role", role]
    ]);
    this.rect = visible ? { width: 10, height: 10 } : { width: 0, height: 0 };
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector === "[role='dialog']" && current.role === "dialog") {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  appendChild() {}

  click() {
    this.clicked += 1;
  }
}

function approvalButton(text, contextText) {
  const card = new FakeElement({ text: contextText, role: "dialog" });
  return new FakeElement({ text, title: text, parent: card });
}

test("content-script actual matcher clicks bounded GitHub approval context", () => {
  const button = approvalButton(
    "确认",
    "GitHub Update README.md in repository? This will update one file in a pull request. 使用工具存在风险。拒绝 确认"
  );
  const internals = loadContentScript([button]);

  const target = internals.findApprovalTarget();

  assert.equal(target?.button, button);
  assert.equal(target.text, "确认");
});

test("content-script actual matcher rejects provider-only context", () => {
  const button = approvalButton(
    "Confirm",
    "GitHub appears in this normal conversation, but this is not an approval card. Confirm"
  );
  const internals = loadContentScript([button]);

  assert.equal(internals.findApprovalTarget(), null);
});

test("content-script actual matcher rejects dangerous delete context", () => {
  const button = approvalButton(
    "Confirm",
    "GitHub Delete workflow file? This will delete one repository file. Reject Confirm"
  );
  const internals = loadContentScript([button]);

  assert.equal(internals.findApprovalTarget(), null);
});

test("content-script actual page state ignores generic cancel buttons", () => {
  const internals = loadContentScript([], {
    selectors: new Set(['button[aria-label*="Cancel"]'])
  });

  assert.equal(internals.classifyPageState().status, "idle");
});

test("content-script scan clicks and reports a safe approval card", async () => {
  const button = approvalButton(
    "Allow",
    "GitHub Update README.md in repository? This will update one file in a pull request. Reject Allow"
  );
  const internals = loadContentScript([button]);

  await internals.runScan("test");

  assert.equal(button.clicked, 1);
  assert.deepEqual(internals.events.map((event) => event.kind), ["approval_clicked"]);
  assert.equal(internals.events[0].detail.text, "Allow");
});

test("content-script scan does not click or report dangerous approval context", async () => {
  const button = approvalButton(
    "Confirm",
    "GitHub Delete workflow file? This will delete one repository file. Reject Confirm"
  );
  const internals = loadContentScript([button]);

  await internals.runScan("test");

  assert.equal(button.clicked, 0);
  assert.deepEqual(internals.events, []);
});
