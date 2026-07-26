import { EventEmitter } from "node:events";
import CDP from "chrome-remote-interface";
import type { Client } from "chrome-remote-interface";
import { shouldCaptureResponseBody, truncateBody } from "../model/bodies.js";
import { RrAssembler } from "../model/rr-assembler.js";
import type { TreeStore } from "../model/store.js";
import type {
  CdpLoadingFailed,
  CdpLoadingFinished,
  CdpRequestWillBeSent,
  CdpResponseReceived,
} from "../model/types.js";

export type CdpConnectionState = "scanning" | "connected";

export interface CdpStatus {
  state: CdpConnectionState;
  host: string;
  port: number;
  attachedTargets: string[];
  lastError?: string;
}

export interface CdpManagerOptions {
  host?: string;
  port?: number;
  store: TreeStore;
  captureBodies?: boolean;
  /** How often to probe for a Chrome CDP endpoint while scanning. */
  scanIntervalMs?: number;
  /** How often to refresh page targets while connected. */
  targetPollIntervalMs?: number;
}

interface AttachedTarget {
  targetId: string;
  client: Client;
  assembler: RrAssembler;
}

interface TargetInfo {
  targetId: string;
  type: string;
  title?: string;
  url?: string;
}

function headersFromExtra(
  headers: Record<string, string> | Array<{ name: string; value: string }> | undefined,
): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const h of headers) out[h.name] = h.value;
    return out;
  }
  return { ...headers };
}

/** CRI Client is an EventEmitter at runtime (`disconnect` on WS close). */
function asEmitter(client: Client): EventEmitter {
  return client as unknown as EventEmitter;
}

export class CdpManager {
  private readonly host: string;
  private readonly port: number;
  private readonly store: TreeStore;
  private readonly captureBodies: boolean;
  private readonly scanIntervalMs: number;
  private readonly targetPollIntervalMs: number;
  private browserClient: Client | null = null;
  private attached = new Map<string, AttachedTarget>();
  private running = false;
  private state: CdpConnectionState = "scanning";
  private lastError: string | undefined;
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private targetPollTimer: ReturnType<typeof setInterval> | null = null;
  private connecting = false;
  private connectGeneration = 0;
  private handlingDisconnect = false;

  constructor(opts: CdpManagerOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 9222;
    this.store = opts.store;
    this.captureBodies = opts.captureBodies ?? true;
    this.scanIntervalMs = opts.scanIntervalMs ?? 2000;
    this.targetPollIntervalMs = opts.targetPollIntervalMs ?? 3000;
  }

  getAttachedTargetIds(): string[] {
    return [...this.attached.keys()];
  }

  getStatus(): CdpStatus {
    const status: CdpStatus = {
      state: this.state,
      host: this.host,
      port: this.port,
      attachedTargets: this.getAttachedTargetIds(),
    };
    if (this.lastError) status.lastError = this.lastError;
    return status;
  }

  /**
   * Begin scanning for a Chrome CDP endpoint. Resolves immediately; does not
   * require Chrome to be running yet.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.state = "scanning";
    console.log(
      `[cdp] scanning for Chrome debugging endpoint at ${this.host}:${this.port} …`,
    );
    this.startScanLoop();
    // Opportunistic first attempt without waiting for the interval.
    void this.tryConnect();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.connectGeneration += 1;
    this.stopScanLoop();
    this.stopTargetPoll();
    await this.teardownBrowser("stopped");
    this.state = "scanning";
  }

  async attachTarget(targetId: string): Promise<boolean> {
    if (!this.browserClient || this.state !== "connected") return false;
    try {
      const { targetInfos } = await this.browserClient.Target.getTargets();
      const info = targetInfos.find((t: TargetInfo) => t.targetId === targetId);
      if (!info) return false;
      await this.maybeAttach(info);
      return this.attached.has(targetId);
    } catch (err) {
      await this.handleBrowserDisconnect(
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  private startScanLoop(): void {
    if (this.scanTimer) return;
    this.scanTimer = setInterval(() => {
      void this.tryConnect();
    }, this.scanIntervalMs);
  }

  private stopScanLoop(): void {
    if (!this.scanTimer) return;
    clearInterval(this.scanTimer);
    this.scanTimer = null;
  }

  private startTargetPoll(): void {
    if (this.targetPollTimer) return;
    this.targetPollTimer = setInterval(() => {
      void this.refreshTargets();
    }, this.targetPollIntervalMs);
  }

  private stopTargetPoll(): void {
    if (!this.targetPollTimer) return;
    clearInterval(this.targetPollTimer);
    this.targetPollTimer = null;
  }

  private async isCdpListening(): Promise<boolean> {
    const url = `http://${this.host}:${this.port}/json/version`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) return false;
      const body = (await res.json()) as { webSocketDebuggerUrl?: string };
      return typeof body.webSocketDebuggerUrl === "string";
    } catch {
      return false;
    }
  }

  private async tryConnect(): Promise<void> {
    if (!this.running || this.browserClient || this.connecting) return;
    if (!(await this.isCdpListening())) return;

    this.connecting = true;
    const gen = ++this.connectGeneration;
    try {
      const client = await CDP({
        host: this.host,
        port: this.port,
      });

      if (!this.running || gen !== this.connectGeneration) {
        try {
          await client.close();
        } catch {
          /* ignore */
        }
        return;
      }

      this.browserClient = client;
      this.state = "connected";
      this.lastError = undefined;
      this.stopScanLoop();

      asEmitter(client).on("disconnect", () => {
        void this.handleBrowserDisconnect("browser websocket closed");
      });

      const { Target } = client;
      await Target.setDiscoverTargets({ discover: true });

      Target.targetCreated((evt) => {
        void this.maybeAttach(evt.targetInfo);
      });
      Target.targetInfoChanged((evt) => {
        void this.maybeAttach(evt.targetInfo);
      });
      Target.detachedFromTarget((evt) => {
        if (evt.targetId) this.detachLocal(evt.targetId);
      });

      await this.refreshTargets();
      this.startTargetPoll();
      console.log(`[cdp] connected to Chrome at ${this.host}:${this.port}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      console.error(`[cdp] connect attempt failed: ${message}`);
      await this.teardownBrowser("connect failed");
      if (this.running) {
        this.state = "scanning";
        this.startScanLoop();
      }
    } finally {
      this.connecting = false;
    }
  }

  private async handleBrowserDisconnect(reason: string): Promise<void> {
    if (!this.running) return;
    if (this.handlingDisconnect) return;
    if (!this.browserClient && this.state === "scanning") return;

    this.handlingDisconnect = true;
    try {
      this.lastError = reason;
      console.warn(
        `[cdp] Chrome CDP lost (${reason}); returning to scan on ${this.host}:${this.port}`,
      );
      this.connectGeneration += 1;
      this.stopTargetPoll();
      await this.teardownBrowser(reason);
      this.state = "scanning";
      if (this.running) this.startScanLoop();
    } finally {
      this.handlingDisconnect = false;
    }
  }

  private async teardownBrowser(_reason: string): Promise<void> {
    for (const id of [...this.attached.keys()]) {
      this.detachLocal(id);
    }
    const client = this.browserClient;
    this.browserClient = null;
    if (client) {
      try {
        asEmitter(client).removeAllListeners("disconnect");
      } catch {
        /* ignore */
      }
      try {
        await client.close();
      } catch {
        /* ignore — already closed on crash */
      }
    }
  }

  private async refreshTargets(): Promise<void> {
    if (!this.browserClient || !this.running || this.state !== "connected") {
      return;
    }
    try {
      const { targetInfos } = await this.browserClient.Target.getTargets();
      for (const info of targetInfos) {
        await this.maybeAttach(info);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[cdp] refreshTargets failed:", message);
      await this.handleBrowserDisconnect(message);
    }
  }

  private async maybeAttach(info: TargetInfo): Promise<void> {
    if (!this.running || this.state !== "connected") return;
    if (info.type !== "page") return;
    if (this.attached.has(info.targetId)) return;

    let client: Client;
    try {
      client = await CDP({
        host: this.host,
        port: this.port,
        target: info.targetId,
      });
    } catch (err) {
      console.error(
        `[cdp] failed to attach ${info.targetId}:`,
        err instanceof Error ? err.message : err,
      );
      return;
    }

    if (!this.running || this.state !== "connected") {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      return;
    }

    const assembler = new RrAssembler(info.targetId);
    const attached: AttachedTarget = {
      targetId: info.targetId,
      client,
      assembler,
    };
    this.attached.set(info.targetId, attached);

    asEmitter(client).on("disconnect", () => {
      this.detachLocal(info.targetId);
    });

    // Only watch the top frame; iframe copies of this script no-op.
    // Debounce in-page so one click/Enter does not flood console.debug.
    const gestureHook = `
      (function () {
        try {
          if (window.top !== window) return;
        } catch (e) { return; }
        if (window.__rrtreeGestureHook) return;
        window.__rrtreeGestureHook = true;
        let lastSent = 0;
        const send = (kind) => {
          const now = Date.now();
          if (now - lastSent < 400) return;
          lastSent = now;
          try {
            console.debug('__rrtree_gesture__', JSON.stringify({ kind, ts: now }));
          } catch (e) {}
        };
        window.addEventListener('click', () => send('click'), true);
        window.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') send('keydown');
        }, true);
      })();
    `;

    try {
      await client.Network.enable({});
      await client.Page.enable();
      await client.Runtime.enable();
      await client.Page.addScriptToEvaluateOnNewDocument({ source: gestureHook });

      client.Network.requestWillBeSent((params) => {
        this.onRequestWillBeSent(attached, params as CdpRequestWillBeSent);
      });
      client.Network.requestWillBeSentExtraInfo((params) => {
        const p = params as {
          requestId: string;
          headers?: Record<string, string>;
        };
        for (const ev of attached.assembler.mergeRequestExtraHeaders(
          p.requestId,
          headersFromExtra(p.headers),
        )) {
          this.store.ingest(ev.node);
        }
      });
      client.Network.responseReceived((params) => {
        this.onResponseReceived(attached, params as CdpResponseReceived);
      });
      client.Network.responseReceivedExtraInfo((params) => {
        const p = params as {
          requestId: string;
          headers?: Record<string, string>;
        };
        for (const ev of attached.assembler.mergeResponseExtraHeaders(
          p.requestId,
          headersFromExtra(p.headers),
        )) {
          this.store.ingest(ev.node);
        }
      });
      client.Network.loadingFinished((params) => {
        void this.onLoadingFinished(attached, params as CdpLoadingFinished);
      });
      client.Network.loadingFailed((params) => {
        this.onLoadingFailed(attached, params as CdpLoadingFailed);
      });
      client.Runtime.consoleAPICalled((params) => {
        if (params.type !== "debug") return;
        const first = params.args?.[0]?.value;
        if (first !== "__rrtree_gesture__") return;
        const raw = params.args?.[1]?.value;
        if (typeof raw !== "string") return;
        try {
          const parsed = JSON.parse(raw) as { kind: string; ts: number };
          this.store.gesture({
            ts: parsed.ts || Date.now(),
            kind: parsed.kind === "keydown" ? "keydown" : "click",
            targetId: info.targetId,
          });
        } catch {
          /* ignore */
        }
      });

      await client.Runtime.evaluate({ expression: gestureHook });
      console.log(
        `[cdp] attached page ${info.targetId} (${info.url || "about:blank"})`,
      );
    } catch (err) {
      console.error(`[cdp] setup failed for ${info.targetId}:`, err);
      this.detachLocal(info.targetId);
    }
  }

  private detachLocal(targetId: string): void {
    const a = this.attached.get(targetId);
    if (!a) return;
    this.attached.delete(targetId);
    try {
      asEmitter(a.client).removeAllListeners("disconnect");
    } catch {
      /* ignore */
    }
    void a.client.close().catch(() => undefined);
    console.log(`[cdp] detached ${targetId}`);
  }

  private onRequestWillBeSent(
    attached: AttachedTarget,
    params: CdpRequestWillBeSent,
  ): void {
    for (const ev of attached.assembler.handleRequestWillBeSent(params)) {
      this.store.ingest(ev.node);
    }
  }

  private onResponseReceived(
    attached: AttachedTarget,
    params: CdpResponseReceived,
  ): void {
    for (const ev of attached.assembler.handleResponseReceived(params)) {
      this.store.ingest(ev.node);
    }
  }

  private async onLoadingFinished(
    attached: AttachedTarget,
    params: CdpLoadingFinished,
  ): Promise<void> {
    const events = attached.assembler.handleLoadingFinished(params);
    for (const ev of events) {
      if (this.captureBodies && !ev.node.failed) {
        const method = ev.node.method.toUpperCase();
        const needsRequestBody =
          ev.node.requestBody?.unavailableReason === "pending" ||
          (!ev.node.requestBody?.text &&
            (method === "POST" || method === "PUT" || method === "PATCH"));
        await this.captureBodiesForNode(
          attached,
          params.requestId,
          String(ev.node.resourceType),
          ev.node.mimeType,
          needsRequestBody,
        );
      }
      const latest = attached.assembler.getNode(params.requestId);
      if (latest) this.store.ingest(latest);
      else this.store.ingest(ev.node);
    }
  }

  private async captureBodiesForNode(
    attached: AttachedTarget,
    requestId: string,
    resourceType: string,
    mimeType: string | undefined,
    wantRequestBody: boolean,
  ): Promise<void> {
    if (wantRequestBody) {
      try {
        const { postData } = await attached.client.Network.getRequestPostData({
          requestId,
        });
        if (postData != null && postData !== "") {
          for (const ev of attached.assembler.setRequestBody(
            requestId,
            truncateBody(postData, false),
          )) {
            this.store.ingest(ev.node);
          }
        } else {
          for (const ev of attached.assembler.setRequestBody(requestId, {
            unavailableReason: "empty",
          })) {
            this.store.ingest(ev.node);
          }
        }
      } catch {
        for (const ev of attached.assembler.setRequestBody(requestId, {
          unavailableReason: "unavailable",
        })) {
          this.store.ingest(ev.node);
        }
      }
    }

    if (!shouldCaptureResponseBody(String(resourceType), mimeType)) {
      for (const ev of attached.assembler.setResponseBody(requestId, {
        unavailableReason: "skipped_binary_or_unsupported_type",
      })) {
        this.store.ingest(ev.node);
      }
      return;
    }

    try {
      const { body, base64Encoded } =
        await attached.client.Network.getResponseBody({ requestId });
      for (const ev of attached.assembler.setResponseBody(
        requestId,
        truncateBody(body, base64Encoded),
      )) {
        this.store.ingest(ev.node);
      }
    } catch {
      for (const ev of attached.assembler.setResponseBody(requestId, {
        unavailableReason: "unavailable",
      })) {
        this.store.ingest(ev.node);
      }
    }
  }

  private onLoadingFailed(
    attached: AttachedTarget,
    params: CdpLoadingFailed,
  ): void {
    for (const ev of attached.assembler.handleLoadingFailed(params)) {
      this.store.ingest(ev.node);
    }
  }
}
