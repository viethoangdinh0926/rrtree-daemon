/** Typed causality edge from parent RR → child RR. */
export type EdgeType =
  | "redirect"
  | "parser"
  | "script"
  | "script_nav"
  | "user_interaction"
  | "preload"
  | "other";

export type ResourceType =
  | "Document"
  | "Stylesheet"
  | "Image"
  | "Media"
  | "Font"
  | "Script"
  | "TextTrack"
  | "XHR"
  | "Fetch"
  | "Prefetch"
  | "EventSource"
  | "WebSocket"
  | "Manifest"
  | "SignedExchange"
  | "Ping"
  | "CSPViolationReport"
  | "Preflight"
  | "Other"
  | string;

export interface InitiatorInfo {
  type: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  requestId?: string;
  stack?: unknown;
}

export interface RrNode {
  id: string;
  requestId: string;
  /** Stable id across redirects that share the same CDP requestId hop chain. */
  redirectChainId?: string;
  url: string;
  method: string;
  resourceType: ResourceType;
  status?: number;
  statusText?: string;
  mimeType?: string;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  timing?: Record<string, number>;
  frameId?: string;
  loaderId?: string;
  targetId?: string;
  bodyRef?: string;
  bodyPreview?: string;
  parentId?: string;
  edgeType?: EdgeType;
  initiator?: InitiatorInfo;
  children: string[];
  treeId?: string;
  failed?: boolean;
  errorText?: string;
  createdAt: number;
  updatedAt: number;
  /** True once responseReceived (or redirect intermediate) applied. */
  hasResponse: boolean;
  /** True once loadingFinished / loadingFailed. */
  finished: boolean;
}

export interface Tree {
  id: string;
  rootId: string;
  targetId?: string;
  createdAt: number;
  updatedAt: number;
}

export type PatchOp = "upsert" | "attach";

export interface TreePatch {
  op: PatchOp;
  treeId: string;
  node: RrNode;
  ts: number;
}

export interface UserGesture {
  ts: number;
  frameId?: string;
  targetId?: string;
  kind: "click" | "keydown" | "other";
}

/** CDP-shaped events consumed by the assembler (subset). */
export interface CdpRequestWillBeSent {
  requestId: string;
  loaderId?: string;
  documentURL?: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
  };
  timestamp: number;
  wallTime?: number;
  initiator: InitiatorInfo;
  redirectResponse?: {
    url: string;
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    mimeType?: string;
    timing?: Record<string, number>;
  };
  type?: ResourceType;
  frameId?: string;
  redirectHasExtraInfo?: boolean;
}

export interface CdpResponseReceived {
  requestId: string;
  loaderId?: string;
  timestamp: number;
  type?: ResourceType;
  response: {
    url: string;
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    mimeType?: string;
    timing?: Record<string, number>;
  };
  frameId?: string;
}

export interface CdpLoadingFinished {
  requestId: string;
  timestamp: number;
  encodedDataLength?: number;
}

export interface CdpLoadingFailed {
  requestId: string;
  timestamp: number;
  type?: ResourceType;
  errorText: string;
  canceled?: boolean;
}
