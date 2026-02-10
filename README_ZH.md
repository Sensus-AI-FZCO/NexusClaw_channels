# sensusai_chat（OpenClaw Channel）

[中文](./README_ZH.md) | [English](./README_EN.md)

`sensusai_chat` 是一个用于 OpenClaw 的 outbound-only channel，
通过 WebSocket 将消息桥接到 Cloudflare Workers/DO 侧（默认协议 `channelId=openclaw-connect`）。

## 1. 开源前检查结论

### 密钥暴露检查

已对仓库内容做关键词扫描（排除 `.git` 与 `node_modules` 后）：
- 未发现硬编码 API Key / Token / 私钥。
- `index.js` 不会直接打印 `deviceSecret`。
- WebSocket 连接日志会对 `sig` 参数脱敏（`sig=REDACTED`）。

仍需注意：
- `deviceId` 会出现在部分日志中（请按你的安全策略评估）。
- 后续新增 `.env`、测试脚本、部署脚本时，避免提交凭据。

### 结构与安装完整性

插件核心文件齐全：
- `index.js`
- `openclaw.plugin.json`
- `package.json`

`package.json` 已包含 OpenClaw 关键字段：
- `openclaw.extensions`
- `openclaw.channels`
- `openclaw.installDependencies`

## 2. 项目结构

```text
.
├── index.js
├── openclaw.plugin.json
├── package.json
├── package-lock.json
├── LICENSE
├── README.md
├── README_ZH.md
└── README_EN.md
```

## 3. 前置条件

- 已安装 OpenClaw CLI。
- Node.js 18+（建议 LTS）。
- 已部署可用 Cloudflare Worker WebSocket 入口（例如：`wss://<your-worker>/ws/device`）。
- 服务端已准备设备身份（`deviceId` / `deviceSecret`）。

## 4. 安装

### 方式 A（推荐）：克隆后本地链接安装

```bash
git clone https://github.com/Sensus-AI-FZCO/NexusClaw_channels.git
cd NexusClaw_channels
npm install
openclaw plugins install -l .
```

说明：`-l` 表示 link 本地目录，适合开发和自用。

如果你已经在本地有仓库，也可直接：

```bash
openclaw plugins install -l <path-to-repo>
```

### 方式 B：按包规范安装（path-or-spec）

`openclaw plugins install` 支持 `path-or-spec`（路径、压缩包、npm spec）。
发布到 npm 后可使用：

```bash
openclaw plugins install <your-npm-package-name>
```

启用并重启：

```bash
openclaw plugins enable sensusai_chat
openclaw gateway restart
```

## 5. 配置说明

在 OpenClaw 中至少填写：
- `Enabled`: `true`
- `Cloud Url`: `https://<your-worker>.workers.dev` 或 `wss://<your-worker>/ws/device`
- `Channel Id`: `openclaw-connect`
- `Device Id`
- `Device Secret`

说明：
- `Cloud Url` 如果是 `https://...`，插件会自动转为 `wss://...`，路径为空时补 `/ws/device`。
- 其余重连、心跳、队列、超时参数可先保持默认。

## 6. 联通验证

```bash
openclaw gateway call channels.status --json
```

重点查看：
- `configured: true`
- `running: true`
- `connected: true`

## 7. 常见问题

### `configured=true` 但未连接

优先检查：
- `Channel Id` 是否与服务端一致（建议 `openclaw-connect`）。
- `Cloud Url` 是否为正确 Worker 地址。
- `Device Secret` 是否与服务端一致。

### 连接后频繁重连

可调优以下参数：
- `reconnectInitialMs`
- `reconnectMaxMs`
- `reconnectFactor`
- `reconnectJitter`
- `wsPingMs`
- `idleTimeoutMs`

## 8. 开源发布前清单

- 不提交 `.env`、密钥文件、部署凭据。
- 不提交 `node_modules`。
- 已包含 MIT `LICENSE`。
- 发版前再执行一次密钥扫描：

```bash
rg -n --hidden -S "(api[_-]?key|secret|token|password|sk-[A-Za-z0-9]|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)" . -g '!node_modules/**' -g '!.git/**'
```
