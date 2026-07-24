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

export interface CdpManagerOptions {
  host?: string;
  port?: number;
  store: TreeStore;
  captureBodies?: boolean;
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

export class CdpManager {
  private readonly host: string;
  private readonly port: number;
  private readonly store: TreeStore;
  private readonly captureBodies: boolean;
  private browserClient: Client | null = null;
  private attached = new Map<string, AttachedTarget>();
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: CdpManagerOptions) {
    this.host = opts.host ?? "127.0.0.1";
    this.port = opts.port ?? 9222;
    this.store = opts.store;
    this.captureBodies = opts.captureBodies ?? true;
  }

  getAttachedTargetIds(): string[] {
    return [...this.attached.keys()];
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.browserClient = await CDP({
      host: this.host,
      port: this.port,
    });

    const { Target } = this.browserClient;
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
    this.pollTimer = setInterval(() => {
      void this.refreshTargets();
    }, 3000);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const id of [...this.attached.keys()]) {
      this.detachLocal(id);
    }
    if (this.browserClient) {
      try {
        await this.browserClient.close();
      } catch {
        /* ignore */
      }
      this.browserClient = null;
    }
  }

  async attachTarget(targetId: string): Promise<boolean> {
    if (!this.browserClient) return false;
    const { targetInfos } = await this.browserClient.Target.getTargets();
    const info = targetInfos.find((t: TargetInfo) => t.targetId === targetId);
    if (!info) return false;
    await this.maybeAttach(info);
    return this.attached.has(targetId);
  }

  private async refreshTargets(): Promise<void> {
    if (!this.browserClient || !this.running) return;
    try {
      const { targetInfos } = await this.browserClient.Target.getTargets();
      for (const info of targetInfos) {
        await this.maybeAttach(info);
      }
    } catch (err) {
      console.error(
        "[cdp] refreshTargets failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  private async maybeAttach(info: TargetInfo): Promise<void> {
    if (!this.running) return;
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

    const assembler = new RrAssembler(info.targetId);
    const attached: AttachedTarget = {
      targetId: info.targetId,
      client,
      assembler,
    };
    this.attached.set(info.targetId, attached);

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
