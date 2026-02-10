# sensusai_chat (OpenClaw Channel)

`sensusai_chat` 是一个用于 OpenClaw 的 outbound-only channel，
通过 WebSocket 将消息桥接到 Cloudflare Workers/DO 侧（默认协议 `channelId=openclaw-connect`）。

## 1. 当前检查结论（开源前）

### 密钥暴露检查

已对仓库内容做关键词扫描（排除 `.git` 与 `node_modules` 后）：
- 未发现硬编码的 API Key / Token / 私钥内容。
- `index.js` 中不会直接打印 `deviceSecret`。
- WebSocket 连接日志里会对 `sig` 参数做脱敏（`sig=REDACTED`）。

仍需注意：
- `deviceId` 会出现在部分运行日志中（这通常可接受，但请按你的安全策略评估）。
- 如果你后续添加 `.env`、测试脚本或部署脚本，请确保不提交到仓库。

### 结构完整性与安装可用性

当前插件核心文件齐全：
- `index.js`
- `openclaw.plugin.json`
- `package.json`

且 `package.json` 中包含 OpenClaw 所需字段：
- `openclaw.extensions`
- `openclaw.channels`
- `openclaw.installDependencies`

可按本 README 的安装步骤直接安装到 OpenClaw。

## 2. 目录结构

```text
.
├── index.js
├── openclaw.plugin.json
├── package.json
├── package-lock.json
└── README.md
```

## 3. 前置条件

- 已安装并可使用 OpenClaw CLI。
- Node.js 18+（建议 LTS）。
- 已部署可用的 Cloudflare Worker WebSocket 入口（示例：`wss://<your-worker>/ws/device`）。
- 已在服务端准备好对应设备身份（`deviceId` / `deviceSecret`）。

## 4. 安装步骤

在本仓库目录执行：

```bash
npm install
```

安装插件到 OpenClaw：

```bash
openclaw plugins install -l /Users/test/Desktop/sensus-ai/NexusClaw_channels
```

启用并重启网关：

```bash
openclaw plugins enable sensusai_chat
openclaw gateway restart
```

## 5. 配置说明（OpenClaw UI / 配置文件）

在 `sensusai_chat` channel 中至少填写以下字段：

- `Enabled`: `true`
- `Cloud Url`: `https://<your-worker>.workers.dev` 或 `wss://<your-worker>/ws/device`
- `Channel Id`: `openclaw-connect`（默认值，建议保持）
- `Device Id`: 与服务端登记设备一致
- `Device Secret`: 与服务端设备密钥一致

说明：
- 若 `Cloud Url` 传入的是 `https://...`，插件会自动转为 `wss://...`，并在路径为空时补 `/ws/device`。
- 其余参数（重连、心跳、队列、超时）可保持默认，按需要再调优。

## 6. 联通验证

查看 channel 状态：

```bash
openclaw gateway call channels.status --json
```

重点关注：
- `configured: true`
- `running: true`
- `connected: true`

若使用 Cloudflare Worker 设备状态接口，也可额外验证设备是否在线。

## 7. 常见问题

### `configured=true` 但未连接

请优先检查：
- `Channel Id` 是否与服务端一致（建议 `openclaw-connect`）。
- `Cloud Url` 是否为正确 Worker 地址。
- `Device Secret` 是否与服务端保存值一致。

### 连上后频繁重连

可按需调优：
- `reconnectInitialMs`
- `reconnectMaxMs`
- `reconnectFactor`
- `reconnectJitter`
- `wsPingMs`
- `idleTimeoutMs`

## 8. 开源发布前建议清单

- 不要提交任何 `.env`、密钥文件或部署凭据。
- 建议不要把 `node_modules` 提交到仓库。
- 建议补充 `LICENSE`（例如 MIT）。
- 发版前再次执行一次密钥扫描。

可用的本地扫描命令示例：

```bash
rg -n --hidden -S "(api[_-]?key|secret|token|password|sk-[A-Za-z0-9]|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)" . -g '!node_modules/**' -g '!.git/**'
```
