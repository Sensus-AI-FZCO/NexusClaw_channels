const { createHash, createHmac, randomUUID } = require("crypto");

let WebSocket = null;
function getWebSocket() {
  if (!WebSocket) {
    WebSocket = require("ws");
  }
  return WebSocket;
}

const PLUGIN_ID = "sensusai_chat";
const CHANNEL_ID = "openclaw-connect";
const DEFAULT_HEARTBEAT_MS = 20000;
const DEFAULT_RECONNECT_MS = 2000;
const DEFAULT_RECONNECT_INITIAL_MS = 2000;
const DEFAULT_RECONNECT_MAX_MS = 30000;
const DEFAULT_RECONNECT_FACTOR = 1.8;
const DEFAULT_RECONNECT_JITTER = 0.25;
const DEFAULT_MAX_QUEUE_SIZE = 500;
const DEFAULT_IDLE_TIMEOUT_MS = 120000;
const DEFAULT_CONNECT_PROBE_TIMEOUT_MS = 2500;
const DEFAULT_WS_PING_MS = 25000;
const DEFAULT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
const DISPLAY_NAME = "sensusai_chat";

const runtimes = new Map();
let latestConfig = null;

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacBase64Url(key, data) {
  const sig = createHmac("sha256", key).update(data).digest("base64");
  return sig.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeCloudWsUrl(base) {
  const url = new URL(base);
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/ws/device";
  }
  return url;
}

function ensureUrl(base, deviceId, deviceSecret, channelId) {
  const url = normalizeCloudWsUrl(base);
  const ts = Date.now();
  const deviceKey = Buffer.from(sha256Hex(deviceSecret), "hex");
  const sig = hmacBase64Url(deviceKey, `${deviceId}.${channelId}.${ts}`);
  url.searchParams.set("deviceId", deviceId);
  url.searchParams.set("channelId", channelId);
  url.searchParams.set("ts", String(ts));
  url.searchParams.set("sig", sig);
  return url.toString();
}

function getAccounts(config) {
  if (!config) return {};
  if (config.cloudUrl || config.deviceId || config.deviceSecret) {
    return {
      default: {
        enabled: config.enabled,
        cloudUrl: config.cloudUrl,
        channelId: config.channelId,
        deviceId: config.deviceId,
        deviceSecret: config.deviceSecret,
        heartbeatMs: config.heartbeatMs,
        reconnectMs: config.reconnectMs,
        reconnectInitialMs: config.reconnectInitialMs,
        reconnectMaxMs: config.reconnectMaxMs,
        reconnectFactor: config.reconnectFactor,
        reconnectJitter: config.reconnectJitter,
        maxQueueSize: config.maxQueueSize,
        idleTimeoutMs: config.idleTimeoutMs,
        connectProbeTimeoutMs: config.connectProbeTimeoutMs,
        wsPingMs: config.wsPingMs,
      },
    };
  }
  if (config.accounts) return config.accounts;
  if (config.channels && config.channels[PLUGIN_ID] && !config.channels[PLUGIN_ID].accounts) {
    return { default: config.channels[PLUGIN_ID] };
  }
  if (config.channels && config.channels[PLUGIN_ID] && config.channels[PLUGIN_ID].accounts) {
    return config.channels[PLUGIN_ID].accounts;
  }
  if (config.channels && config.channels[CHANNEL_ID] && !config.channels[CHANNEL_ID].accounts) {
    return { default: config.channels[CHANNEL_ID] };
  }
  if (config.channels && config.channels[CHANNEL_ID] && config.channels[CHANNEL_ID].accounts) {
    return config.channels[CHANNEL_ID].accounts;
  }
  return {};
}

function pickNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

function resolveAccount(config, accountId) {
  const accounts = getAccounts(config);
  const account = accounts[accountId];
  if (!account) return null;
  const configured = Boolean(account.cloudUrl && account.deviceId && account.deviceSecret);
  const reconnectMs = pickNumber(account.reconnectMs, DEFAULT_RECONNECT_MS);
  return {
    id: accountId,
    configured,
    enabled: account.enabled !== false,
    cloudUrl: account.cloudUrl,
    channelId: account.channelId || CHANNEL_ID,
    deviceId: account.deviceId,
    deviceSecret: account.deviceSecret,
    heartbeatMs: pickNumber(account.heartbeatMs, DEFAULT_HEARTBEAT_MS),
    reconnectMs,
    reconnectInitialMs: pickNumber(account.reconnectInitialMs, reconnectMs || DEFAULT_RECONNECT_INITIAL_MS),
    reconnectMaxMs: pickNumber(account.reconnectMaxMs, DEFAULT_RECONNECT_MAX_MS),
    reconnectFactor: pickNumber(account.reconnectFactor, DEFAULT_RECONNECT_FACTOR),
    reconnectJitter: pickNumber(account.reconnectJitter, DEFAULT_RECONNECT_JITTER),
    maxQueueSize: Math.max(1, Math.floor(pickNumber(account.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE))),
    idleTimeoutMs: Math.max(30000, Math.floor(pickNumber(account.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS))),
    connectProbeTimeoutMs: Math.max(500, Math.floor(pickNumber(account.connectProbeTimeoutMs, DEFAULT_CONNECT_PROBE_TIMEOUT_MS))),
    wsPingMs: Math.max(10000, Math.floor(pickNumber(account.wsPingMs, DEFAULT_WS_PING_MS))),
  };
}

function listAccountIds(config) {
  const accounts = getAccounts(config);
  return Object.keys(accounts);
}

function isAccountConfigured(account) {
  return Boolean(account && account.configured);
}

function jitterDelay(baseMs, jitterRatio) {
  if (!jitterRatio || jitterRatio <= 0) return baseMs;
  const jitterSpan = baseMs * jitterRatio;
  const min = Math.max(0, baseMs - jitterSpan);
  const max = baseMs + jitterSpan;
  return Math.floor(min + Math.random() * (max - min));
}

function computeBackoff(account, attempt) {
  const safeAttempt = Math.max(1, attempt);
  const growth = account.reconnectInitialMs * Math.pow(account.reconnectFactor, safeAttempt - 1);
  const capped = Math.min(account.reconnectMaxMs, growth);
  return jitterDelay(capped, account.reconnectJitter);
}

function classifyDisconnect(meta) {
  const reasonText = String(meta?.reason || "").toLowerCase();
  const code = Number(meta?.code || 0);
  const text = `${reasonText} ${meta?.message || ""}`.toLowerCase();

  if ([1008, 4001, 4003, 4401, 4403].includes(code)) {
    return { recoverable: false, reason: "unauthorized" };
  }

  if (
    text.includes("unauthorized")
    || text.includes("forbidden")
    || text.includes("403")
    || text.includes("401")
    || text.includes("channel mismatch")
    || text.includes("device mismatch")
    || text.includes("invalid signature")
  ) {
    return { recoverable: false, reason: "unauthorized" };
  }

  if (text.includes("network") || text.includes("timeout") || text.includes("econn") || code === 1006) {
    return { recoverable: true, reason: "network_error" };
  }

  if (text.includes("idle timeout")) {
    return { recoverable: true, reason: "idle_timeout" };
  }

  return { recoverable: true, reason: "socket_closed" };
}

function getConfigFromApi(api) {
  return (
    latestConfig
    || api?.config?.get?.(PLUGIN_ID)
    || api?.config?.get?.(CHANNEL_ID)
    || api?.config
  );
}

function sendEvent(account, runtime, { name, payload, msgId }) {
  const envelope = {
    v: 1,
    type: "event",
    name,
    ts: Date.now(),
    deviceId: account.deviceId,
    sessionId: null,
    msgId: msgId || randomUUID(),
    payload,
  };
  runtime.send(envelope);
}

function collectMediaUrls(payload) {
  const direct = Array.isArray(payload?.mediaUrls) ? payload.mediaUrls : [];
  const fromAttachments = Array.isArray(payload?.attachments)
    ? payload.attachments
      .map((item) => item?.getUrl || item?.url || item?.mediaUrl || null)
      .filter(Boolean)
    : [];
  const merged = [...direct, ...fromAttachments].filter((item) => typeof item === "string" && item.trim());
  return Array.from(new Set(merged));
}

function safeUrlHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

async function probeMediaUrlReachability(api, url, timeoutMs = 8000) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    api?.logger?.info?.(
      `[${CHANNEL_ID}] media probe host=${safeUrlHost(url)} status=${response.status} ms=${durationMs}`
    );
    try {
      response.body?.cancel?.();
    } catch {
      // no-op
    }
    return response.ok;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    api?.logger?.warn?.(
      `[${CHANNEL_ID}] media probe failed host=${safeUrlHost(url)} ms=${durationMs} err=${String(err)}`
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveInboundMedia(api, payload) {
  const mediaUrls = collectMediaUrls(payload);
  if (mediaUrls.length === 0) {
    return { mediaUrls: [], reachableUrls: [], mediaPaths: [], mediaTypes: [] };
  }

  const runtime = api?.runtime;
  const fetchRemoteMedia = runtime?.channel?.media?.fetchRemoteMedia;
  const saveMediaBuffer = runtime?.channel?.media?.saveMediaBuffer;
  if (typeof fetchRemoteMedia !== "function" || typeof saveMediaBuffer !== "function") {
    api?.logger?.warn?.(`[${CHANNEL_ID}] media runtime helpers unavailable; using remote URLs`);
    return { mediaUrls, reachableUrls: mediaUrls, mediaPaths: [], mediaTypes: [] };
  }

  const reachableUrls = [];
  const mediaPaths = [];
  const mediaTypes = [];
  for (const url of mediaUrls) {
    const reachable = await probeMediaUrlReachability(api, url);
    if (reachable) reachableUrls.push(url);
    try {
      const fetched = await fetchRemoteMedia({ url, maxBytes: DEFAULT_MEDIA_MAX_BYTES });
      const saved = await saveMediaBuffer(
        fetched.buffer,
        fetched.contentType ?? undefined,
        "inbound",
        DEFAULT_MEDIA_MAX_BYTES
      );
      mediaPaths.push(saved.path);
      const mediaType = saved.contentType ?? fetched.contentType;
      if (mediaType) mediaTypes.push(mediaType);
      api?.logger?.info?.(
        `[${CHANNEL_ID}] media preload ok host=${safeUrlHost(url)} local=${String(saved.path)}`
      );
    } catch (err) {
      api?.logger?.warn?.(
        `[${CHANNEL_ID}] media preload failed host=${safeUrlHost(url)} err=${String(err)}`
      );
    }
  }

  return { mediaUrls, reachableUrls, mediaPaths, mediaTypes };
}

function buildAttachmentSummary(payload) {
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
  const mediaUrls = collectMediaUrls(payload);
  if (attachments.length === 0 && mediaUrls.length === 0) return "";

  const lines = [];
  const seenUrls = new Set();

  attachments.forEach((item, index) => {
    const fileName = String(
      item?.fileName
      || item?.filename
      || item?.name
      || `attachment-${index + 1}`
    ).trim();
    const mime = String(item?.mime || item?.contentType || "").trim();
    const url = String(item?.getUrl || item?.url || item?.mediaUrl || "").trim();
    if (url) seenUrls.add(url);
    const tags = [];
    if (mime) tags.push(mime);
    if (url) tags.push(url);
    lines.push(`- ${fileName}${tags.length ? ` (${tags.join(" | ")})` : ""}`);
  });

  mediaUrls.forEach((url) => {
    if (!seenUrls.has(url)) lines.push(`- media (${url})`);
  });

  return lines.length > 0 ? `Attachments:\n${lines.join("\n")}` : "";
}

async function dispatchInboundReply(api, account, runtime, incoming) {
  const cfg = getConfigFromApi(api);
  const rt = api?.runtime;
  const dispatcher = rt?.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  const routeResolver = rt?.channel?.routing?.resolveAgentRoute;
  if (!cfg || typeof dispatcher !== "function" || typeof routeResolver !== "function") {
    return false;
  }

  const payload = incoming?.payload || {};
  const text = String(payload?.text || "").trim();
  const media = await resolveInboundMedia(api, payload);
  const mediaUrls = media.mediaUrls;
  const preferredMedia = media.mediaPaths.length > 0 ? media.mediaPaths : media.reachableUrls;
  const attachmentSummary = buildAttachmentSummary(payload);
  const rawBody = [text, attachmentSummary].filter(Boolean).join("\n\n").trim();
  if (!rawBody) return false;

  const peerId = String(
    payload?.senderId
    || payload?.from
    || incoming?.sessionId
    || incoming?.msgId
    || "app"
  );

  const route = routeResolver({
    cfg,
    channel: PLUGIN_ID,
    accountId: account.id,
    peer: { kind: "dm", id: peerId },
  });

  const sendPayload = (replyPayload, kind) => {
    const outText = String(replyPayload?.text || "");
    if (!outText) return;
    if (kind === "block") {
      sendEvent(account, runtime, {
        name: "message.delta",
        msgId: incoming?.msgId || randomUUID(),
        payload: {
          delta: outText,
          final: false,
          sequence: runtime.nextSeq(),
        },
      });
      return;
    }
    sendEvent(account, runtime, {
      name: "message.recv",
      msgId: incoming?.msgId || randomUUID(),
      payload: {
        contentType: "text/plain",
        text: outText,
        replyTo: incoming?.msgId || null,
      },
    });
  };

  if (mediaUrls.length > 0 && preferredMedia.length === 0) {
    api?.logger?.warn?.(
      `[${CHANNEL_ID}] media unavailable after preload: msgId=${String(incoming?.msgId || "")} urls=${mediaUrls.length}`
    );
  }

  const baseCtx = {
    Body: rawBody,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    BodyForCommands: rawBody,
    ...(preferredMedia.length > 0
      ? {
          MediaUrl: preferredMedia[0],
          MediaUrls: preferredMedia,
          ...(media.mediaPaths.length > 0 ? { MediaPath: media.mediaPaths[0], MediaPaths: media.mediaPaths } : {}),
          ...(media.mediaTypes.length > 0
            ? { MediaType: media.mediaTypes[0], MediaTypes: media.mediaTypes }
            : {}),
        }
      : {}),
    From: peerId,
    To: account.deviceId,
    SessionKey: route.sessionKey,
    AccountId: account.id,
    ChatType: "direct",
    OriginatingChannel: PLUGIN_ID,
    OriginatingTo: peerId,
    MessageSid: incoming?.msgId || randomUUID(),
    ReplyToId: incoming?.msgId || undefined,
    CommandAuthorized: true,
  };
  const finalizeInboundContext = rt?.channel?.reply?.finalizeInboundContext;
  const ctxPayload = typeof finalizeInboundContext === "function"
    ? finalizeInboundContext(baseCtx)
    : baseCtx;

  const resolveStorePath = rt?.channel?.session?.resolveStorePath;
  const recordInboundSession = rt?.channel?.session?.recordInboundSession;
  if (typeof resolveStorePath === "function" && typeof recordInboundSession === "function") {
    try {
      const storePath = resolveStorePath(cfg?.session?.store, {
        agentId: route?.agentId,
      });
      await recordInboundSession({
        storePath,
        sessionKey: ctxPayload.SessionKey || route.sessionKey,
        ctx: ctxPayload,
        onRecordError: (err) => {
          api?.logger?.warn?.(`[${CHANNEL_ID}] recordInboundSession failed: ${String(err)}`);
        },
      });
    } catch (err) {
      api?.logger?.warn?.(`[${CHANNEL_ID}] recordInboundSession exception: ${String(err)}`);
    }
  }

  await dispatcher({
    cfg,
    ctx: ctxPayload,
    dispatcherOptions: {
      deliver: async (replyPayload, info) => {
        sendPayload(replyPayload, info?.kind);
      },
      onError: (err, info) => {
        api?.logger?.error?.(
          `[${CHANNEL_ID}] reply dispatch error kind=${String(info?.kind || "unknown")} ${String(err)}`
        );
      },
      onSkip: (_payload, info) => {
        api?.logger?.warn?.(
          `[${CHANNEL_ID}] reply skipped kind=${String(info?.kind || "unknown")} reason=${String(info?.reason || "unknown")}`
        );
      },
    },
  });

  return true;
}

function emitConnectionState(account, runtime, stateName, extra = {}) {
  sendEvent(account, runtime, {
    name: "connection.state",
    payload: {
      state: stateName,
      ...(extra.attempt != null ? { attempt: extra.attempt } : {}),
      ...(extra.reason ? { reason: extra.reason } : {}),
      ...(extra.nextRetryMs != null ? { nextRetryMs: extra.nextRetryMs } : {}),
    },
  });
}

async function runConnectProbe(account, log) {
  try {
    const cloud = new URL(account.cloudUrl);
    const health = new URL(cloud.pathname.replace(/\/ws\/device$/, "/healthz") || "/healthz", cloud);
    health.protocol = cloud.protocol === "wss:" ? "https:" : "http:";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), account.connectProbeTimeoutMs);
    try {
      const response = await fetch(health.toString(), { signal: controller.signal });
      log.info?.(
        `[${CHANNEL_ID}] [${account.id}] probe ${health.origin} => ${response.status}`
      );
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    log.warn?.(`[${CHANNEL_ID}] [${account.id}] probe failed: ${String(err)}`);
    return false;
  }
}

function createRuntime(api, account) {
  const log = api?.logger ?? console;
  const state = {
    running: false,
    ws: null,
    seq: 0,
    droppedCount: 0,
    sendQueue: [],
    reconnectTimer: null,
    heartbeatTimer: null,
    idleTimer: null,
    wsPingTimer: null,
    reconnectAttempt: 0,
    stopped: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    lastConnectedAt: null,
  };

  const cleanupIntervals = () => {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
    if (state.idleTimer) {
      clearInterval(state.idleTimer);
      state.idleTimer = null;
    }
    if (state.wsPingTimer) {
      clearInterval(state.wsPingTimer);
      state.wsPingTimer = null;
    }
  };

  const pushQueue = (msg) => {
    state.sendQueue.push(msg);
    if (state.sendQueue.length > account.maxQueueSize) {
      state.sendQueue.shift();
      state.droppedCount += 1;
      if (state.droppedCount % 25 === 0 || state.droppedCount === 1) {
        log.warn?.(
          `[${CHANNEL_ID}] [${account.id}] offline queue dropped=${state.droppedCount} maxQueueSize=${account.maxQueueSize}`
        );
      }
    }
  };

  const flushQueue = () => {
    if (!state.ws || state.ws.readyState !== getWebSocket().OPEN) return;
    while (state.sendQueue.length > 0) {
      const queued = state.sendQueue.shift();
      try {
        state.ws.send(queued);
        state.lastOutboundAt = Date.now();
      } catch (err) {
        state.lastError = String(err);
        pushQueue(queued);
        break;
      }
    }
  };

  const scheduleReconnect = (why) => {
    if (state.stopped) return;
    if (state.reconnectTimer) return;
    state.reconnectAttempt += 1;
    const delayMs = computeBackoff(account, state.reconnectAttempt);
    log.warn?.(
      `[${CHANNEL_ID}] [${account.id}] reconnect attempt=${state.reconnectAttempt} in ${delayMs}ms reason=${why.reason}`
    );
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      openSocket();
    }, delayMs);
  };

  const onDisconnected = (meta) => {
    state.running = false;
    state.lastStopAt = Date.now();
    const info = classifyDisconnect(meta);
    state.lastError = `${info.reason}${meta?.reason ? `: ${meta.reason}` : ""}`;
    cleanupIntervals();
    if (!state.stopped && info.recoverable) {
      scheduleReconnect(info);
    } else if (!info.recoverable) {
      log.error?.(`[${CHANNEL_ID}] [${account.id}] unrecoverable disconnect: ${state.lastError}`);
    }
  };

  const onIdleCheck = () => {
    if (!state.ws || state.ws.readyState !== getWebSocket().OPEN) return;
    const lastActivity = Math.max(state.lastInboundAt || 0, state.lastOutboundAt || 0, state.lastConnectedAt || 0);
    if (!lastActivity) return;
    if (Date.now() - lastActivity < account.idleTimeoutMs) return;
    try {
      state.ws.close(4000, "idle timeout");
    } catch {
      // ignore
    }
  };

  const openSocket = () => {
    if (state.stopped) return;

    const wsUrl = ensureUrl(account.cloudUrl, account.deviceId, account.deviceSecret, account.channelId);
    log.info?.(`[${CHANNEL_ID}] [${account.id}] opening ws ${wsUrl.replace(/sig=[^&]+/, "sig=REDACTED")}`);
    const ws = new (getWebSocket())(wsUrl);
    state.ws = ws;

    let disconnected = false;
    const disconnectOnce = (meta) => {
      if (disconnected) return;
      disconnected = true;
      onDisconnected(meta);
    };

    ws.on("open", () => {
      state.running = true;
      state.lastStartAt = Date.now();
      state.lastConnectedAt = Date.now();
      state.lastInboundAt = Date.now();
      state.lastOutboundAt = Date.now();
      state.lastError = null;
      state.reconnectAttempt = 0;

      log.info?.(`[${CHANNEL_ID}] [${account.id}] ws connected channel=${account.channelId}`);

      flushQueue();
      emitConnectionState(account, runtime, "connected");

      cleanupIntervals();
      state.heartbeatTimer = setInterval(() => {
        sendEvent(account, runtime, {
          name: "presence",
          payload: { status: "online", source: CHANNEL_ID },
        });
      }, account.heartbeatMs);
      state.wsPingTimer = setInterval(() => {
        if (!state.ws || state.ws.readyState !== getWebSocket().OPEN) return;
        try {
          state.ws.ping();
          state.lastOutboundAt = Date.now();
        } catch (err) {
          state.lastError = String(err);
          try {
            state.ws.close(1011, "ping failed");
          } catch {
            // ignore
          }
        }
      }, account.wsPingMs);
      state.idleTimer = setInterval(onIdleCheck, Math.min(30000, account.idleTimeoutMs));
    });

    ws.on("message", (data) => {
      state.lastInboundAt = Date.now();
      handleIncoming(api, account, runtime, data.toString());
    });

    ws.on("pong", () => {
      state.lastInboundAt = Date.now();
    });

    ws.on("close", (code, reasonBuffer) => {
      const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString("utf8") : String(reasonBuffer || "");
      log.warn?.(`[${CHANNEL_ID}] [${account.id}] ws closed code=${code || 0} reason=${reason || "n/a"}`);
      disconnectOnce({ code, reason });
    });

    ws.on("error", (err) => {
      log.error?.(`[${CHANNEL_ID}] [${account.id}] ws error`, err);
      disconnectOnce({ message: String(err) });
    });
  };

  const runtime = {
    account,
    state,
    start() {
      state.stopped = false;
      openSocket();
    },
    close() {
      state.stopped = true;
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      cleanupIntervals();
      if (state.ws) {
        try {
          state.ws.close(1000, "shutdown");
        } catch {
          // ignore
        }
      }
      state.running = false;
      state.lastStopAt = Date.now();
    },
    send(payload) {
      const msg = JSON.stringify(payload);
      if (state.ws && state.ws.readyState === getWebSocket().OPEN) {
        try {
          state.ws.send(msg);
          state.lastOutboundAt = Date.now();
          return;
        } catch (err) {
          state.lastError = String(err);
        }
      }
      pushQueue(msg);
    },
    nextSeq() {
      state.seq += 1;
      return state.seq;
    },
    snapshot() {
      return {
        running: state.running,
        queueSize: state.sendQueue.length,
        droppedCount: state.droppedCount,
        reconnectAttempt: state.reconnectAttempt,
        lastStartAt: state.lastStartAt,
        lastStopAt: state.lastStopAt,
        lastError: state.lastError,
        lastInboundAt: state.lastInboundAt,
        lastOutboundAt: state.lastOutboundAt,
      };
    },
  };

  return runtime;
}

function ensureRuntime(api, account) {
  const existing = runtimes.get(account.id);
  if (existing) {
    existing.account = account;
    return existing;
  }
  const runtime = createRuntime(api, account);
  runtimes.set(account.id, runtime);
  return runtime;
}

function startAccount(api, account) {
  const log = api?.logger ?? console;
  log.info?.(`[${CHANNEL_ID}] [${account.id}] startAccount called enabled=${account.enabled} configured=${account.configured}`);
  if (!isAccountConfigured(account)) {
    log.warn?.(`[${CHANNEL_ID}] [${account.id}] skipped start: incomplete config`);
    return null;
  }
  const runtime = ensureRuntime(api, account);
  if (!runtime.state.running) {
    runtime.state.stopped = false;
    runtime.start();
    log.info?.(`[${CHANNEL_ID}] [${account.id}] start requested`);
  }
  void runConnectProbe(account, log);
  return runtime;
}

function handleIncoming(api, account, runtime, raw) {
  let message = null;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (!message || message.type !== "event") return;

  if (message.name === "message.send") {
    const payload = message.payload || {};
    const mediaUrls = collectMediaUrls(payload);
    const hasAttachments = Array.isArray(payload.attachments) && payload.attachments.length > 0;
    const hasMediaUrls = mediaUrls.length > 0;
    const textLen = String(payload?.text || "").trim().length;
    const processingHint = (hasAttachments || hasMediaUrls)
      ? "已收到附件，正在分析中..."
      : "已收到，正在思考中...";
    api?.logger?.info?.(
      `[${CHANNEL_ID}] [${account.id}] inbound message.send msgId=${String(message.msgId || "")} textLen=${textLen} attachments=${hasAttachments ? payload.attachments.length : 0} mediaUrls=${mediaUrls.length}`
    );
    sendEvent(account, runtime, {
      name: "message.recv",
      msgId: message.msgId || randomUUID(),
      payload: {
        contentType: "text/plain",
        text: processingHint,
        replyTo: message.msgId || null,
        phase: "processing",
      },
    });
    api?.logger?.info?.(
      `[${CHANNEL_ID}] [${account.id}] sent processing hint msgId=${String(message.msgId || "")}`
    );
    // Always dispatch through OpenClaw reply pipeline to support text + media.
    Promise.resolve(dispatchInboundReply(api, account, runtime, message))
      .then((handled) => {
        api?.logger?.info?.(
          `[${CHANNEL_ID}] [${account.id}] inbound dispatch handled=${handled ? "true" : "false"} msgId=${String(message.msgId || "")}`
        );
        if (!handled) {
          api?.logger?.warn?.(
            `[${CHANNEL_ID}] [${account.id}] dropped inbound: no text/media payload`
          );
          if (hasAttachments || hasMediaUrls) {
            api?.logger?.warn?.(
              `[${CHANNEL_ID}] [${account.id}] inbound attachment payload did not produce dispatch context`
            );
          }
        }
      })
      .catch((err) => {
        api?.logger?.error?.(`[${CHANNEL_ID}] inbound dispatch failed: ${String(err)}`);
      });
    sendEvent(account, runtime, {
      name: "ack",
      msgId: randomUUID(),
      payload: {
        ack: message.msgId,
        status: "processed",
        attempt: runtime.state.reconnectAttempt,
        receivedAt: Date.now(),
      },
    });
  }
}

function withAccountRuntime(api, accountId) {
  const account = resolveAccount(getConfigFromApi(api), accountId);
  if (!account) throw new Error("unknown account");
  if (!isAccountConfigured(account)) throw new Error("account not configured");
  const runtime = ensureRuntime(api, account);
  if (!runtime.state.running && !runtime.state.stopped) {
    runtime.start();
  }
  return { account, runtime };
}

function buildTopLevelSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      cloudUrl: { type: "string" },
      channelId: { type: "string", default: CHANNEL_ID },
      deviceId: { type: "string" },
      deviceSecret: { type: "string" },
      heartbeatMs: { type: "number", default: DEFAULT_HEARTBEAT_MS },
      reconnectMs: { type: "number", default: DEFAULT_RECONNECT_MS },
      reconnectInitialMs: { type: "number", default: DEFAULT_RECONNECT_INITIAL_MS },
      reconnectMaxMs: { type: "number", default: DEFAULT_RECONNECT_MAX_MS },
      reconnectFactor: { type: "number", default: DEFAULT_RECONNECT_FACTOR },
      reconnectJitter: { type: "number", default: DEFAULT_RECONNECT_JITTER },
      maxQueueSize: { type: "number", default: DEFAULT_MAX_QUEUE_SIZE },
      idleTimeoutMs: { type: "number", default: DEFAULT_IDLE_TIMEOUT_MS },
      connectProbeTimeoutMs: { type: "number", default: DEFAULT_CONNECT_PROBE_TIMEOUT_MS },
      wsPingMs: { type: "number", default: DEFAULT_WS_PING_MS },
    },
  };
}

function buildUiHints() {
  return {
    channelId: { label: "Channel Id" },
    cloudUrl: {
      label: "Cloud Url",
      placeholder: "wss://<your-worker>/ws/device",
    },
    deviceId: { label: "Device Id" },
    deviceSecret: {
      label: "Device Secret",
      sensitive: true,
    },
    // Keep required connection fields prominent; move tuning knobs to advanced.
    heartbeatMs: { label: "Heartbeat Ms", advanced: true },
    reconnectMs: { label: "Reconnect Ms", advanced: true },
    reconnectInitialMs: { label: "Reconnect Initial Ms", advanced: true },
    reconnectMaxMs: { label: "Reconnect Max Ms", advanced: true },
    reconnectFactor: { label: "Reconnect Factor", advanced: true },
    reconnectJitter: { label: "Reconnect Jitter", advanced: true },
    maxQueueSize: { label: "Max Queue Size", advanced: true },
    idleTimeoutMs: { label: "Idle Timeout Ms", advanced: true },
    connectProbeTimeoutMs: { label: "Connect Probe Timeout Ms", advanced: true },
    wsPingMs: { label: "WS Ping Ms", advanced: true },
  };
}

function register(api) {
  api.registerChannel({
    plugin: {
      id: PLUGIN_ID,
      meta: {
        order: 900,
        label: DISPLAY_NAME,
        detailLabel: DISPLAY_NAME,
      },
      reload: { configPrefixes: [`channels.${PLUGIN_ID}`, `channels.${CHANNEL_ID}`] },
      configSchema: {
        schema: buildTopLevelSchema(),
        uiHints: buildUiHints(),
      },
      capabilities: {
        chatTypes: ["direct"],
        media: ["image"],
        blockStreaming: true,
      },
      config: {
        listAccountIds,
        resolveAccount,
        isConfigured: isAccountConfigured,
      },
      status: {
        defaultRuntime: {
          accountId: "default",
          running: false,
          connected: false,
        },
        buildAccountSnapshot: async ({ account, cfg, runtime }) => {
          const resolved = resolveAccount(cfg, account?.id || "default") || account;
          return {
            accountId: resolved?.id || "default",
            enabled: Boolean(resolved?.enabled !== false),
            configured: isAccountConfigured(resolved),
            running: Boolean(runtime?.running),
            connected: Boolean(runtime?.connected ?? runtime?.running),
            lastStartAt: runtime?.lastStartAt ?? null,
            lastStopAt: runtime?.lastStopAt ?? null,
            lastError: runtime?.lastError ?? null,
            queueSize: runtime?.queueSize ?? 0,
            reconnectAttempt: runtime?.reconnectAttempt ?? 0,
            droppedCount: runtime?.droppedCount ?? 0,
          };
        },
        buildChannelSummary: async ({ snapshot }) => ({
          configured: Boolean(snapshot?.configured),
          running: Boolean(snapshot?.running),
          connected: Boolean(snapshot?.connected),
          lastStartAt: snapshot?.lastStartAt ?? null,
          lastStopAt: snapshot?.lastStopAt ?? null,
          lastError: snapshot?.lastError ?? null,
        }),
      },
      gateway: {
        startAccount: async ({ cfg, accountId, abortSignal, setStatus, log }) => {
          latestConfig = cfg;
          const account = resolveAccount(cfg, accountId);
          if (!account || !account.enabled) {
            setStatus({
              accountId,
              running: false,
              connected: false,
              lastError: "disabled",
            });
            return;
          }
          if (!isAccountConfigured(account)) {
            setStatus({
              accountId,
              running: false,
              connected: false,
              lastError: "not configured",
            });
            return;
          }

          const runtime = startAccount(api, account);
          const pushStatus = () => {
            setStatus({
              accountId,
              running: Boolean(runtime?.state?.running),
              connected: Boolean(runtime?.state?.running),
              ...runtime?.snapshot?.(),
            });
          };
          pushStatus();
          const ticker = setInterval(pushStatus, 1000);

          await new Promise((resolve) => {
            if (abortSignal?.aborted) {
              resolve();
              return;
            }
            abortSignal?.addEventListener("abort", resolve, { once: true });
          });
          clearInterval(ticker);

          const current = runtimes.get(accountId);
          if (current) {
            current.close();
          }
          setStatus({
            accountId,
            running: false,
            connected: false,
            ...current?.snapshot?.(),
          });
          log?.info?.(`[${CHANNEL_ID}] [${accountId}] stop requested`);
        },
        stopAccount: async ({ accountId, setStatus }) => {
          const runtime = runtimes.get(accountId);
          if (runtime) {
            runtime.close();
            runtimes.delete(accountId);
          }
          setStatus({
            accountId,
            running: false,
            connected: false,
            ...runtime?.snapshot?.(),
          });
        },
      },
      outbound: {
        deliveryMode: "direct",
        sendText: async ({ text, accountId, msgId, replyTo }) => {
          const { account, runtime } = withAccountRuntime(api, accountId);
          sendEvent(account, runtime, {
            name: "message.recv",
            msgId,
            payload: {
              contentType: "text/plain",
              text,
              replyTo: replyTo || null,
            },
          });
        },
        sendMedia: async ({ attachments, accountId, msgId, text }) => {
          const { account, runtime } = withAccountRuntime(api, accountId);
          sendEvent(account, runtime, {
            name: "message.recv",
            msgId,
            payload: {
              contentType: "image",
              text: text || "",
              attachments: attachments || [],
            },
          });
        },
      },
      streaming: {
        deliveryMode: "direct",
        sendDelta: async ({ delta, accountId, msgId, sequence, final }) => {
          const { account, runtime } = withAccountRuntime(api, accountId);
          sendEvent(account, runtime, {
            name: "message.delta",
            msgId,
            payload: {
              delta,
              final: Boolean(final),
              sequence: sequence ?? runtime.nextSeq(),
            },
          });
        },
      },
    },
  });
}

const plugin = {
  id: PLUGIN_ID,
  name: DISPLAY_NAME,
  description: "Outbound-only OpenClaw channel that bridges to Cloudflare Workers/DO via WebSocket.",
  configSchema: {
    ...buildTopLevelSchema(),
  },
  meta: {
    order: 900,
  },
  register,
};

module.exports = plugin;
module.exports.register = register;
module.exports.activate = register;
