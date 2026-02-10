# sensusai_chat (OpenClaw Channel)

[中文](./README_ZH.md) | [English](./README_EN.md)

`sensusai_chat` is an outbound-only OpenClaw channel that bridges messages
to Cloudflare Workers/DO over WebSocket (default protocol `channelId=openclaw-connect`).

## 1. Pre-release Check Summary

### Secret Exposure Check

Keyword scanning was run on this repository (excluding `.git` and `node_modules`):
- No hardcoded API keys / tokens / private keys were found.
- `index.js` does not directly print `deviceSecret`.
- WebSocket logs redact the `sig` query parameter (`sig=REDACTED`).

Please still note:
- `deviceId` appears in some runtime logs (review with your security policy).
- If you add `.env`, test scripts, or deployment scripts later, do not commit credentials.

### Structure and Install Readiness

Core plugin files are present:
- `index.js`
- `openclaw.plugin.json`
- `package.json`

`package.json` already includes required OpenClaw fields:
- `openclaw.extensions`
- `openclaw.channels`
- `openclaw.installDependencies`

## 2. Project Structure

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

## 3. Prerequisites

- OpenClaw CLI installed.
- Node.js 18+ (LTS recommended).
- A working Cloudflare Worker WebSocket endpoint (for example: `wss://<your-worker>/ws/device`).
- Device credentials prepared on server side (`deviceId` / `deviceSecret`).

## 4. Installation

### Method A (Recommended): clone and install from local repo

```bash
git clone https://github.com/Sensus-AI-FZCO/NexusClaw_channels.git
cd NexusClaw_channels
npm install
openclaw plugins install -l .
```

Note: `-l` links the local directory, useful for development and self-hosted setups.

If the repo already exists locally, run:

```bash
openclaw plugins install -l <path-to-repo>
```

### Method B: install by package spec (`path-or-spec`)

`openclaw plugins install` supports local paths, archives, and npm specs.
After publishing to npm:

```bash
openclaw plugins install <your-npm-package-name>
```

Enable and restart gateway:

```bash
openclaw plugins enable sensusai_chat
openclaw gateway restart
```

## 5. Configuration

In OpenClaw channel config, set at least:
- `Enabled`: `true`
- `Cloud Url`: `https://<your-worker>.workers.dev` or `wss://<your-worker>/ws/device`
- `Channel Id`: `openclaw-connect`
- `Device Id`
- `Device Secret`

Notes:
- If `Cloud Url` is `https://...`, the plugin auto-converts to `wss://...` and appends `/ws/device` when path is empty.
- Keep reconnect/heartbeat/queue/timeout settings as defaults unless tuning is needed.

## 6. Connectivity Check

```bash
openclaw gateway call channels.status --json
```

Focus on:
- `configured: true`
- `running: true`
- `connected: true`

## 7. FAQ

### `configured=true` but not connected

Check first:
- `Channel Id` matches server-side expected value (`openclaw-connect` recommended).
- `Cloud Url` points to the correct Worker endpoint.
- `Device Secret` matches server-side stored value.

### Frequent reconnects

Tune if necessary:
- `reconnectInitialMs`
- `reconnectMaxMs`
- `reconnectFactor`
- `reconnectJitter`
- `wsPingMs`
- `idleTimeoutMs`

## 8. Open-source Release Checklist

- Do not commit `.env`, secret files, or deployment credentials.
- Do not commit `node_modules`.
- MIT `LICENSE` is included.
- Run one more secret scan before release:

```bash
rg -n --hidden -S "(api[_-]?key|secret|token|password|sk-[A-Za-z0-9]|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY)" . -g '!node_modules/**' -g '!.git/**'
```
