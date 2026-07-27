declare module "chrome-remote-interface" {
  export interface TargetInfo {
    targetId: string;
    type: string;
    title?: string;
    url?: string;
    attached?: boolean;
  }

  namespace Target {
    export type TargetInfo = import("chrome-remote-interface").TargetInfo;
  }

  export interface Client {
    Network: {
      enable: (opts?: object) => Promise<void>;
      getResponseBody: (opts: {
        requestId: string;
      }) => Promise<{ body: string; base64Encoded: boolean }>;
      getRequestPostData: (opts: {
        requestId: string;
      }) => Promise<{ postData: string }>;
      requestWillBeSent: (cb: (params: unknown) => void) => void;
      requestWillBeSentExtraInfo: (cb: (params: unknown) => void) => void;
      responseReceived: (cb: (params: unknown) => void) => void;
      responseReceivedExtraInfo: (cb: (params: unknown) => void) => void;
      loadingFinished: (cb: (params: unknown) => void) => void;
      loadingFailed: (cb: (params: unknown) => void) => void;
    };
    Page: {
      enable: () => Promise<void>;
      navigate: (opts: { url: string }) => Promise<unknown>;
      addScriptToEvaluateOnNewDocument: (opts: {
        source: string;
      }) => Promise<unknown>;
      getFrameTree: () => Promise<{
        frameTree: { frame: { id: string; parentId?: string } };
      }>;
      frameNavigated: (cb: (params: {
        frame: { id: string; parentId?: string; url?: string };
      }) => void) => void;
    };
    Runtime: {
      enable: () => Promise<void>;
      evaluate: (opts: {
        expression: string;
        returnByValue?: boolean;
      }) => Promise<{ result?: { value?: unknown } }>;
      consoleAPICalled: (cb: (params: {
        type: string;
        args?: Array<{ value?: unknown }>;
      }) => void) => void;
    };
    Input: {
      dispatchMouseEvent: (opts: {
        type: string;
        x: number;
        y: number;
        button?: string;
        clickCount?: number;
      }) => Promise<void>;
    };
    Target: {
      setDiscoverTargets: (opts: { discover: boolean }) => Promise<void>;
      setAutoAttach: (opts: {
        autoAttach: boolean;
        waitForDebuggerOnStart: boolean;
        flatten?: boolean;
      }) => Promise<void>;
      getTargets: () => Promise<{ targetInfos: TargetInfo[] }>;
      attachToTarget: (opts: {
        targetId: string;
        flatten?: boolean;
      }) => Promise<{ sessionId: string }>;
      targetCreated: (cb: (evt: { targetInfo: TargetInfo }) => void) => void;
      targetInfoChanged: (cb: (evt: { targetInfo: TargetInfo }) => void) => void;
      detachedFromTarget: (cb: (evt: {
        targetId?: string;
        sessionId?: string;
      }) => void) => void;
    };
    close: () => Promise<void>;
  }

  export interface Options {
    host?: string;
    port?: number;
    target?: string;
    sessionId?: string;
  }

  function CDP(options?: Options): Promise<Client>;
  export default CDP;
}
