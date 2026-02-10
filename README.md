# OpenClaw Channels Integration Notes

本文档说明 `sensusai_chat` channel 的改造结论、部署流程、以及 App/插件参数如何填写。

## 1) 改造要点与当前状态

- Channel 插件 ID 已统一为 `sensusai_chat`。
- 协议 `channelId` 仍保持 `openclaw-connect`（用于云端鉴权与协议兼容）。
- 已适配 OpenClaw 2026 网关生命周期：
  - 使用 `gateway.startAccount/stopAccount`（不是旧的 `gateway.start/stop`）。
- 已验证链路：
  - OpenClaw `channels.status` 可见 `sensusai_chat` 且 `running/connected` 正常。
  - Worker 设备状态接口返回 `online: true`（设备在线时）。

## 2) 目录与职责

- Channel 插件代码：
  - `channels/openclaw-connect/index.js`
  - `channels/openclaw-connect/openclaw.plugin.json`
- Worker 代码：
  - `server/src/index.ts`
  - `server/wrangler.toml`
- 环境变量：
  - `server/.env`：Worker 侧配置（含 R2 与服务端密钥）
  - `server/.env.app`：App/插件侧填写参数（便于和 Worker 配置分离）

## 3) 部署（Worker）

在 `server/` 下执行：

```bash
npx -y wrangler@4.63.0 deploy
```

如需重新写入 secrets（按提示粘贴值）：

```bash
npx -y wrangler@4.63.0 secret put DEVICE_KEYS_JSON
npx -y wrangler@4.63.0 secret put PAIRING_CODES_JSON
npx -y wrangler@4.63.0 secret put DEVICE_ACCESS_JSON
npx -y wrangler@4.63.0 secret put SESSION_SECRET
npx -y wrangler@4.63.0 secret put R2_ACCESS_KEY_ID
npx -y wrangler@4.63.0 secret put R2_SECRET_ACCESS_KEY
npx -y wrangler@4.63.0 secret put R2_ACCOUNT_ID
npx -y wrangler@4.63.0 secret put R2_BUCKET
```

说明：

- `R2_*` 保持你现有 `.env` 值即可，不需要为本次 channel 改造变更。
- Worker 名称当前为 `sensusai_chat`（见 `server/wrangler.toml`）。

## 4) 参数填写（App 与 OpenClaw 插件）

### 4.1 App 端填写（来自 `server/.env.app`）

V2 推荐：

- `CLOUD_BASE_URL`
- `CONNECT_TOKEN`

兼容回退（旧模式）：

- `DEVICE_ID`
- `CHANNEL_ID`（应为 `openclaw-connect`）
- `PAIRING_CODE`

### 4.2 OpenClaw Channel 配置填写

在 OpenClaw UI / 配置里，`sensusai_chat` 至少填写：

- `Channel Id` = `openclaw-connect`
- `Cloud Url` = `https://<your-worker>.workers.dev`（插件会自动补 `wss://.../ws/device`）
- `Device Id` = 与 `.env.app` 一致
- `Device Secret` = `.env.app` 的 `DEVICE_SECRET`
- `Enabled` = `true`

## 5) 安装/启用插件（OpenClaw）

先禁用旧版，再覆盖安装新版：

```bash
openclaw plugins disable sensusai_chat || true
```

安装并启用新版：

```bash
openclaw plugins install -l /Users/test/Desktop/sensus-ai/openclaw-connect/channels/openclaw-connect
openclaw plugins enable sensusai_chat
openclaw gateway restart
```

## 6) 联通检查

### 6.1 本地 channel 运行状态

```bash
openclaw gateway call channels.status --json
```

重点看：

- `channels.sensusai_chat.running == true`
- `channels.sensusai_chat.connected == true`

### 6.2 云端设备在线状态

```bash
curl -sS "https://<your-worker>.workers.dev/v1/devices/<DEVICE_ID>/status"
```

重点看：

- `online: true`
- `deviceChannelId: "openclaw-connect"`

## 7) 常见问题

- 现象：`configured=true` 但不运行  
  原因：插件若仍是旧生命周期（`gateway.start/stop`）会被 OpenClaw 2026 忽略。  
  处理：确认 `index.js` 使用 `startAccount/stopAccount`。

- 现象：密钥看起来“对了”但连不上  
  常见原因：`channelId` 不一致、`cloudUrl` 填了错误路径、`deviceSecret` 与服务端哈希不匹配。  
  处理：对照 `.env.app` 与 Worker secrets 逐项核对。
