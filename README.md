# sensusai_chat (OpenClaw Channel)

`sensusai_chat` 是一个用于 OpenClaw 的 outbound-only channel，
通过 WebSocket 将消息桥接到 Cloudflare Workers/DO 侧（默认协议 `channelId=openclaw-connect`）。

`sensusai_chat` is an outbound-only OpenClaw channel that bridges messages
to Cloudflare Workers/DO over WebSocket (default protocol `channelId=openclaw-connect`).

## 1. 当前检查结论（开源前） / Pre-release Check Summary

### 密钥暴露检查 / Secret Exposure Check

已对仓库内容做关键词扫描（排除 `.git` 与 `node_modules` 后）：
- 未发现硬编码的 API Key / Token / 私钥内容。
- `index.js` 中不会直接打印 `deviceSecret`。
- WebSocket 连接日志里会对 `sig` 参数做脱敏（`sig=REDACTED`）。

仍需注意：
- `deviceId` 会出现在部分运行日志中（这通常可接受，但请按你的安全策略评估）。
- 如果你后续添加 `.env`、测试脚本或部署脚本，请确保不提交到仓库。

Keyword-based secret scanning was run on this repo (excluding `.git` and `node_modules`):
- No hardcoded API keys / tokens / private keys were found.
- `index.js` does not directly print `deviceSecret`.
- WebSocket logs redact the `sig` query parameter (`sig=REDACTED`).

Please still note:
- `deviceId` appears in some runtime logs (usually acceptable, review per your policy).
- If you add `.env`, test scripts, or deploy scripts later, do not commit credentials.

### 结构完整性与安装可用性 / Structure and Install Readiness

当前插件核心文件齐全：
- `index.js`
- `openclaw.plugin.json`
- `package.json`

且 `package.json` 中包含 OpenClaw 所需字段：
- `openclaw.extensions`
- `openclaw.channels`
- `openclaw.installDependencies`

可按本 README 的安装步骤直接安装到 OpenClaw。

Core plugin files are complete:
- `index.js`
- `openclaw.plugin.json`
- `package.json`

`package.json` contains required OpenClaw fields:
- `openclaw.extensions`
- `openclaw.channels`
- `openclaw.installDependencies`

You can install directly with the steps in this README.

## 2. 目录结构 / Project Structure

```text
.
├── index.js
├── openclaw.plugin.json
├── package.json
├── package-lock.json
└── README.md
```

## 3. 前置条件 / Prerequisites

- 已安装并可使用 OpenClaw CLI。
- Node.js 18+（建议 LTS）。
- 已部署可用的 Cloudflare Worker WebSocket 入口（示例：`wss://<your-worker>/ws/device`）。
- 已在服务端准备好对应设备身份（`deviceId` / `deviceSecret`）。

- OpenClaw CLI installed and available.
- Node.js 18+ (LTS recommended).
- A deployed Cloudflare Worker WebSocket endpoint (for example: `wss://<your-worker>/ws/device`).
- Device credentials prepared on the server side (`deviceId` / `deviceSecret`).

## 4. 安装步骤 / Installation

在本仓库目录执行：

```bash
npm install
```

### 方式 A（推荐）：克隆后本地安装 / Method A (Recommended): Clone and Local Link

```bash
git clone https://github.com/Sensus-AI-FZCO/NexusClaw_channels.git
cd NexusClaw_channels
npm install
openclaw plugins install -l .
```

说明：`-l` 表示 link 当前本地目录，适合开发和自用。

如果你已经在本地任意位置有仓库，也可直接：

```bash
openclaw plugins install -l <path-to-repo>
```

`-l` links the local directory (good for local development and self-hosted usage).

If you already have the repo in any local path, you can run:

```bash
openclaw plugins install -l <path-to-repo>
```

### 方式 B：通过包规范安装（path-or-spec） / Method B: Install by package spec (path-or-spec)

`openclaw plugins install` 支持 `path-or-spec`（路径、压缩包、npm spec）。
如果你发布到了 npm，可直接：

```bash
openclaw plugins install <your-npm-package-name>
```

`openclaw plugins install` supports `path-or-spec` (local path, archive, or npm spec).
If you publish to npm, install with:

```bash
openclaw plugins install <your-npm-package-name>
```

启用并重启网关：

```bash
openclaw plugins enable sensusai_chat
openclaw gateway restart
```

Enable and restart gateway:

```bash
openclaw plugins enable sensusai_chat
openclaw gateway restart
```

## 5. 配置说明（OpenClaw UI / 配置文件） / Configuration (OpenClaw UI / config file)

在 `sensusai_chat` channel 中至少填写以下字段：

- `Enabled`: `true`
- `Cloud Url`: `https://<your-worker>.workers.dev` 或 `wss://<your-worker>/ws/device`
- `Channel Id`: `openclaw-connect`（默认值，建议保持）
- `Device Id`: 与服务端登记设备一致
- `Device Secret`: 与服务端设备密钥一致

说明：
- 若 `Cloud Url` 传入的是 `https://...`，插件会自动转为 `wss://...`，并在路径为空时补 `/ws/device`。
- 其余参数（重连、心跳、队列、超时）可保持默认，按需要再调优。

Fill at least these fields in `sensusai_chat`:
- `Enabled`: `true`
- `Cloud Url`: `https://<your-worker>.workers.dev` or `wss://<your-worker>/ws/device`
- `Channel Id`: `openclaw-connect` (default, recommended to keep)
- `Device Id`: must match server-side registered device id
- `Device Secret`: must match server-side device secret

Notes:
- If `Cloud Url` is `https://...`, the plugin auto-converts to `wss://...` and appends `/ws/device` when path is empty.
- Keep advanced reconnect/heartbeat/queue/timeout settings as defaults unless tuning is needed.

## 6. 联通验证 / Connectivity Check

查看 channel 状态：

```bash
openclaw gateway call channels.status --json
```

重点关注：
- `configured: true`
- `running: true`
- `connected: true`

若使用 Cloudflare Worker 设备状态接口，也可额外验证设备是否在线。

Check channel status:

```bash
openclaw gateway call channels.status --json
```

Focus on:
- `configured: true`
- `running: true`
- `connected: true`

If available, also verify online status from your Cloudflare Worker device status API.

## 7. 常见问题 / FAQ

### `configured=true` 但未连接 / `configured=true` but not connected

请优先检查：
- `Channel Id` 是否与服务端一致（建议 `openclaw-connect`）。
- `Cloud Url` 是否为正确 Worker 地址。
- `Device Secret` 是否与服务端保存值一致。

Check first:
- `Channel Id` matches server-side expected value (`openclaw-connect` recommended).
- `Cloud Url` points to the correct Worker endpoint.
- `Device Secret` matches server-side stored secret.

### 连上后频繁重连 / Frequent reconnects after connection

可按需调优：
- `reconnectInitialMs`
- `reconnectMaxMs`
- `reconnectFactor`
- `reconnectJitter`
- `wsPingMs`
- `idleTimeoutMs`

Tune as needed:
- `reconnectInitialMs`
- `reconnectMaxMs`
- `reconnectFactor`
- `reconnectJitter`
- `wsPingMs`
- `idleTimeoutMs`

## 8. 开源发布前建议清单 / Open-source Release Checklist

- 不要提交任何 `.env`、密钥文件或部署凭据。
- 建议不要把 `node_modules` 提交到仓库。
- 已补充 `MIT LICENSE`。
- 发版前再次执行一次密钥扫描。

可用的本地扫描命令示例：

```bash
rg -n --hidden -S "(api[_-]?key|secret|token|password|sk-[A-Za-z0-9]|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)" . -g '!node_modules/**' -g '!.git/**'
```

- Do not commit any `.env`, secret files, or deployment credentials.
- Do not commit `node_modules`.
- MIT `LICENSE` is included.
- Run one more secret scan before release.

Sample local scan command:

```bash
rg -n --hidden -S "(api[_-]?key|secret|token|password|sk-[A-Za-z0-9]|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)" . -g '!node_modules/**' -g '!.git/**'
```
