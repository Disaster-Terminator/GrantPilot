# GrantPilot

<p>
  <img alt="extension Manifest V3" src="https://img.shields.io/badge/extension-MV3-4285F4">
  <img alt="target ChatGPT Web" src="https://img.shields.io/badge/target-ChatGPT%20Web-10A37F">
  <img alt="browser Chrome / Edge" src="https://img.shields.io/badge/browser-Chrome%20%2F%20Edge-5F6368">
  <img alt="dev Node.js 18+" src="https://img.shields.io/badge/dev-Node.js%2018%2B-339933">
</p>

[English](./README_EN.md)

GrantPilot 是一个面向 ChatGPT Web 的轻量 Chrome / Edge Manifest V3 扩展。用户在弹窗里明确启用后，它会在 ChatGPT 会话页监听应用、连接器、MCP 或工具调用的授权卡片，并且只点击卡片内部的正向确认按钮。

它的目标很窄：减少 ChatGPT 工具调用过程中重复点击“确认 / Allow”的机械操作，同时避免变成危险的通用自动点击器。

## 它不是什么

GrantPilot 不是通用 auto-clicker。

它不处理：

- 外部 OAuth、登录或账号授权页面。
- 支付、删除、账号管理、管理员审批等高风险流程。
- ChatGPT Web 之外的泛权限升级页面。
- `拒绝`、`取消`、`Reject`、`Deny`、`Cancel` 等负向按钮。

如果页面不是 ChatGPT 工具 / 应用授权卡片，GrantPilot 应该什么都不做。

## 核心行为

- 扩展只注入 `https://chatgpt.com/*` 和 `https://chat.openai.com/*`。
- 运行时动作进一步隔离到具体会话页：`/c/<conversation-id>` 和 `/g/<project-id>/c/<conversation-id>`。
- 默认关闭，需要在扩展弹窗里手动启用。
- 识别 `确认`、`允许`、`批准`、`继续`、`Confirm`、`Allow`、`Approve`、`Continue` 等正向按钮。
- 识别 `拒绝`、`取消`、`Deny`、`Reject`、`Cancel` 等负向按钮，但只把它们当作安全边界，永不点击。
- 点击前要求按钮附近存在工具、应用、连接器、MCP 或 ChatGPT app response 相关上下文。
- ChatGPT 页面出现可见错误时，会同步显示到扩展弹窗和页面右下角提示条。
- 可选自动刷新只作用于会话页，并且只在没有授权卡片、没有 ChatGPT 可见错误、没有生成中控制按钮时触发。
- 自动刷新使用用户选择的固定基础间隔，并加入随机抖动，避免机械固定节奏：
  - Fast：约 10s
  - Normal：约 20s
  - Relaxed：约 30s
- 自动刷新只会在观察到会话活动后 armed；单纯打开一个静止会话页不会启动刷新。

## 本地安装

1. 打开 `edge://extensions` 或 `chrome://extensions`。
2. 启用开发者模式。
3. 点击 **Load unpacked / 加载已解压的扩展程序**。
4. 选择仓库里的 `src/extension` 目录。
5. 打开 ChatGPT Web，在 GrantPilot 弹窗里启用它。

## 弹窗功能

- **Enabled**：开启或关闭授权卡片扫描。
- **Auto refresh**：在会话页空闲时按退避间隔刷新。
- **Refresh cadence**：选择自动刷新基础间隔：约 10s、20s 或 30s。实际刷新会加入随机抖动。
- **Local JSONL log**：把事件写入本地调试日志服务。
- **Last issue / Recent events**：查看最近一次问题、点击、刷新和运行时事件。

## 调试日志

扩展会把最近事件保存在 extension local storage，并显示在弹窗里。

如果需要写入本地 JSONL 文件，先运行：

```bash
npm run debug:log-server
```

然后在弹窗里开启 **Local JSONL log**。默认情况下，事件会发送到 `http://127.0.0.1:17762/events`，并追加写入 `tmp/grantpilot/events.jsonl`。

也可以用环境变量覆盖调试服务配置：

```bash
GRANTPILOT_DEBUG_HOST=127.0.0.1 \
GRANTPILOT_DEBUG_PORT=17762 \
GRANTPILOT_DEBUG_LOG=tmp/grantpilot/events.jsonl \
npm run debug:log-server
```

## 手动验收

ChatGPT Web 的真实页面自动化不稳定，这个仓库不把完整 e2e 自动化当成可靠前提。合入前建议做这些手动检查：

- 关闭状态：展示一个 ChatGPT 应用 / 工具授权卡片，确认不会自动点击。
- 开启状态：展示类似 `Update README.md in GitHub repository?` 的卡片，确认右侧 `确认` / `Allow` 被点击。
- 安全边界：确认左侧 `拒绝` / `Cancel` 不会被点击。
- 页面隔离：在 `https://chatgpt.com/` 首页启用 auto-refresh，确认不会记录 `page_refresh`。
- 自动刷新：在会话页启用 auto-refresh，分别选择 10s / 20s / 30s，确认只有观察到会话活动后才 armed，并按基础间隔加随机抖动刷新。
- 错误暴露：当 ChatGPT 页面出现生成错误时，确认弹窗和页面提示条能显示问题。

## 开发

```bash
npm test
npm run check
```

`npm test` 会运行 `tests/*.test.mjs` 下的 matcher 和页面策略测试。

`npm run check` 会检查扩展脚本、共享逻辑和 `manifest.json` 的语法。

## 仓库结构

```text
src/extension/          MV3 扩展文件
  manifest.json         Chrome / Edge 扩展清单
  background.js         设置、事件存储、徽标状态、本地日志转发
  content-script.js     ChatGPT 页面扫描、授权识别、错误提示、自动刷新
  popup.html            扩展弹窗 UI
  popup.js              弹窗状态绑定和设置更新
  popup.css             弹窗样式
src/shared/             可测试的匹配、页面策略与文本处理逻辑
tests/                  基于 node:test 的行为测试
scripts/                可选本地 JSONL 调试日志服务
```
