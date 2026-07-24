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

export interface BodyPayload {
  /** Decoded text when available; omitted for binary or unavailable bodies. */
  text?: string;
  /** True when original bytes were base64 (binary / non-UTF8). */
  base64Encoded?: boolean;
  /** Raw base64 when text decode is inappropriate (truncated). */
  base64?: string;
  /** Byte length before truncation. */
  size?: number;
  /** True when stored content was truncated to the capture cap. */
  truncated?: boolean;
  /** Why body is missing when neither text nor base64 is set. */
  unavailableReason?: string;
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
  /** POST/PUT body from CDP (postData / getRequestPostData). */
  requestBody?: BodyPayload;
  /** Response body when capturable (getResponseBody). */
  responseBody?: BodyPayload;
  /** @deprecated Prefer responseBody.text */
  bodyRef?: string;
  /** @deprecated Prefer responseBody.text */
  bodyPreview?: string;
  timing?: Record<string, number>;
  frameId?: string;
  loaderId?: string;
  targetId?: string;
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
    postData?: string;
    hasPostData?: boolean;
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
