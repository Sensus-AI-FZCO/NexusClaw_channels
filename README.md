# sensusai_chat (OpenClaw Channel)

[中文文档](./README_ZH.md) | [English](./README_EN.md)

Outbound-only OpenClaw channel for bridging messages to Cloudflare Workers/DO over WebSocket.

## Quick Install

```bash
git clone https://github.com/Sensus-AI-FZCO/NexusClaw_channels.git
cd NexusClaw_channels
npm install
openclaw plugins install -l .
openclaw plugins enable sensusai_chat
openclaw gateway restart
```

## Configure Required Fields

Set the following in OpenClaw channel config:
- `Enabled=true`
- `Cloud Url`
- `Channel Id=openclaw-connect`
- `Device Id`
- `Device Secret`

For full setup, troubleshooting, and release checklist, read:
- [README_ZH.md](./README_ZH.md)
- [README_EN.md](./README_EN.md)
