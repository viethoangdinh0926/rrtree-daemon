import type {
  CdpLoadingFailed,
  CdpLoadingFinished,
  CdpRequestWillBeSent,
  CdpResponseReceived,
  RrNode,
} from "./types.js";

export interface AssembledEvent {
  kind: "node";
  node: RrNode;
  /** When set, this node completes a redirect hop; next request shares requestId. */
  isRedirectHop?: boolean;
}

let seq = 0;

function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}-${Date.now()}`;
}

function headersOf(h: Record<string, string> | undefined): Record<string, string> {
  return h ? { ...h } : {};
}

export class RrAssembler {
  /** In-flight nodes keyed by CDP requestId (current hop). */
  private byRequestId = new Map<string, RrNode>();
  /** Previous hop node id for the same requestId during redirects. */
  private lastHopByRequestId = new Map<string, string>();
  private targetId?: string;

  constructor(targetId?: string) {
    this.targetId = targetId;
  }

  setTargetId(targetId: string): void {
    this.targetId = targetId;
  }

  getNode(requestId: string): RrNode | undefined {
    return this.byRequestId.get(requestId);
  }

  getNodeById(id: string): RrNode | undefined {
    for (const n of this.byRequestId.values()) {
      if (n.id === id) return n;
    }
    return undefined;
  }

  /** All nodes ever produced in this assembler (current hop map only — callers use store). */
  handleRequestWillBeSent(ev: CdpRequestWillBeSent): AssembledEvent[] {
    const out: AssembledEvent[] = [];
    const now = Date.now();

    if (ev.redirectResponse) {
      const prev = this.byRequestId.get(ev.requestId);
      if (prev) {
        prev.status = ev.redirectResponse.status;
        prev.statusText = ev.redirectResponse.statusText;
        prev.responseHeaders = headersOf(ev.redirectResponse.headers);
        prev.mimeType = ev.redirectResponse.mimeType;
        prev.timing = ev.redirectResponse.timing;
        prev.hasResponse = true;
        prev.finished = true;
        prev.updatedAt = now;
        out.push({ kind: "node", node: { ...prev, children: [...prev.children] }, isRedirectHop: true });
        this.lastHopByRequestId.set(ev.requestId, prev.id);
      } else {
        // Synthetic node for redirect response when we missed the original requestWillBeSent.
        const synthetic: RrNode = {
          id: nextId("rr"),
          requestId: ev.requestId,
          url: ev.redirectResponse.url,
          method: ev.request.method,
          resourceType: ev.type ?? "Other",
          status: ev.redirectResponse.status,
          statusText: ev.redirectResponse.statusText,
          mimeType: ev.redirectResponse.mimeType,
          requestHeaders: {},
          responseHeaders: headersOf(ev.redirectResponse.headers),
          timing: ev.redirectResponse.timing,
          frameId: ev.frameId,
          loaderId: ev.loaderId,
          targetId: this.targetId,
          children: [],
          initiator: ev.initiator,
          createdAt: now,
          updatedAt: now,
          hasResponse: true,
          finished: true,
        };
        out.push({ kind: "node", node: synthetic, isRedirectHop: true });
        this.lastHopByRequestId.set(ev.requestId, synthetic.id);
      }
    }

    const node: RrNode = {
      id: nextId("rr"),
      requestId: ev.requestId,
      redirectChainId: this.lastHopByRequestId.get(ev.requestId),
      url: ev.request.url,
      method: ev.request.method,
      resourceType: ev.type ?? "Other",
      requestHeaders: headersOf(ev.request.headers),
      responseHeaders: {},
      frameId: ev.frameId,
      loaderId: ev.loaderId,
      targetId: this.targetId,
      children: [],
      initiator: {
        type: ev.initiator?.type ?? "other",
        url: ev.initiator?.url,
        lineNumber: ev.initiator?.lineNumber,
        columnNumber: ev.initiator?.columnNumber,
        requestId: ev.initiator?.requestId,
        stack: ev.initiator?.stack,
      },
      createdAt: now,
      updatedAt: now,
      hasResponse: false,
      finished: false,
    };

    // Wire redirect edge hint: parent is previous hop.
    if (ev.redirectResponse && this.lastHopByRequestId.has(ev.requestId)) {
      node.parentId = this.lastHopByRequestId.get(ev.requestId);
      node.edgeType = "redirect";
    }

    this.byRequestId.set(ev.requestId, node);
    out.push({ kind: "node", node: { ...node, children: [] } });
    return out;
  }

  handleResponseReceived(ev: CdpResponseReceived): AssembledEvent[] {
    const node = this.byRequestId.get(ev.requestId);
    if (!node) return [];
    const now = Date.now();
    node.status = ev.response.status;
    node.statusText = ev.response.statusText;
    node.responseHeaders = headersOf(ev.response.headers);
    node.mimeType = ev.response.mimeType;
    node.timing = ev.response.timing;
    if (ev.type) node.resourceType = ev.type;
    if (ev.frameId) node.frameId = ev.frameId;
    if (ev.loaderId) node.loaderId = ev.loaderId;
    node.hasResponse = true;
    node.updatedAt = now;
    return [{ kind: "node", node: cloneNode(node) }];
  }

  handleLoadingFinished(ev: CdpLoadingFinished): AssembledEvent[] {
    const node = this.byRequestId.get(ev.requestId);
    if (!node) return [];
    node.finished = true;
    node.updatedAt = Date.now();
    return [{ kind: "node", node: cloneNode(node) }];
  }

  handleLoadingFailed(ev: CdpLoadingFailed): AssembledEvent[] {
    const node = this.byRequestId.get(ev.requestId);
    if (!node) return [];
    node.finished = true;
    node.failed = true;
    node.errorText = ev.errorText;
    if (ev.type) node.resourceType = ev.type;
    node.updatedAt = Date.now();
    return [{ kind: "node", node: cloneNode(node) }];
  }
}

function cloneNode(n: RrNode): RrNode {
  return {
    ...n,
    children: [...n.children],
    requestHeaders: { ...n.requestHeaders },
    responseHeaders: { ...n.responseHeaders },
    initiator: n.initiator ? { ...n.initiator } : undefined,
  };
}

/** Reset module sequence counter (tests). */
export function resetAssemblerSeq(): void {
  seq = 0;
}
