import CDP from "chrome-remote-interface";
import type { Client } from "chrome-remote-interface";
import { RrAssembler } from "../model/rr-assembler.js";
import type { TreeStore } from "../model/store.js";
import type {
  CdpLoadingFailed,
  CdpLoadingFinished,
  CdpRequestWillBeSent,
  CdpResponseReceived,
} from "../model/types.js";

const BODY_TYPES = new Set(["Document", "XHR", "Fetch"]);
const BODY_MAX_BYTES = 256 * 1024;

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

    const gestureHook = `
      (function () {
        if (window.__rrtreeGestureHook) return;
        window.__rrtreeGestureHook = true;
        const send = (kind) => {
          try {
            console.debug('__rrtree_gesture__', JSON.stringify({ kind, ts: Date.now() }));
          } catch (e) {}
        };
        window.addEventListener('click', () => send('click'), true);
        window.addEventListener('keydown', () => send('keydown'), true);
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
      client.Network.responseReceived((params) => {
        this.onResponseReceived(attached, params as CdpResponseReceived);
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
      if (
        this.captureBodies &&
        BODY_TYPES.has(String(ev.node.resourceType)) &&
        !ev.node.failed
      ) {
        try {
          const { body, base64Encoded } =
            await attached.client.Network.getResponseBody({
              requestId: params.requestId,
            });
          let text = body;
          if (base64Encoded) {
            text = Buffer.from(body, "base64").toString("utf8");
          }
          if (text.length > BODY_MAX_BYTES) {
            ev.node.bodyPreview = text.slice(0, BODY_MAX_BYTES);
            ev.node.bodyRef = `truncated:${text.length}`;
          } else {
            ev.node.bodyPreview = text;
            ev.node.bodyRef = `inline:${text.length}`;
          }
        } catch {
          /* body unavailable */
        }
      }
      this.store.ingest(ev.node);
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
