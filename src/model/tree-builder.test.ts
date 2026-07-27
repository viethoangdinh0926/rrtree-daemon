import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import { RrAssembler, resetAssemblerSeq } from "./rr-assembler.js";
import {
  clearTrees,
  createTreeState,
  deleteTree,
  integrateNode,
  recordGesture,
  resetTreeSeq,
  setMainFrame,
} from "./tree-builder.js";
import type {
  CdpLoadingFailed,
  CdpLoadingFinished,
  CdpRequestWillBeSent,
  CdpResponseReceived,
} from "./types.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");

type FixtureEvent =
  | { event: "requestWillBeSent"; params: CdpRequestWillBeSent }
  | { event: "responseReceived"; params: CdpResponseReceived }
  | { event: "loadingFinished"; params: CdpLoadingFinished }
  | { event: "loadingFailed"; params: CdpLoadingFailed };

function loadFixture(name: string): FixtureEvent[] {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as FixtureEvent[];
}

function replay(events: FixtureEvent[], targetId = "T1") {
  resetAssemblerSeq();
  resetTreeSeq();
  const assembler = new RrAssembler(targetId);
  const state = createTreeState();
  const patches = [];
  for (const ev of events) {
    let assembled = [];
    switch (ev.event) {
      case "requestWillBeSent":
        assembled = assembler.handleRequestWillBeSent(ev.params);
        break;
      case "responseReceived":
        assembled = assembler.handleResponseReceived(ev.params);
        break;
      case "loadingFinished":
        assembled = assembler.handleLoadingFinished(ev.params);
        break;
      case "loadingFailed":
        assembled = assembler.handleLoadingFailed(ev.params);
        break;
    }
    for (const a of assembled) {
      patches.push(...integrateNode(state, a.node));
    }
  }
  return { state, patches };
}

describe("redirect chain", () => {
  beforeEach(() => {
    resetAssemblerSeq();
    resetTreeSeq();
  });

  it("builds a single tree with redirect edges", () => {
    const { state } = replay(loadFixture("redirect-chain.json"));
    expect(state.trees.size).toBe(1);
    const tree = [...state.trees.values()][0]!;
    const nodes = [...state.nodes.values()].filter((n) => n.treeId === tree.id);
    expect(nodes.length).toBe(3);

    const byUrl = Object.fromEntries(nodes.map((n) => [n.url, n]));
    expect(byUrl["https://example.com/a"]?.status).toBe(302);
    expect(byUrl["https://example.com/b"]?.edgeType).toBe("redirect");
    expect(byUrl["https://example.com/b"]?.parentId).toBe(byUrl["https://example.com/a"]?.id);
    expect(byUrl["https://example.com/c"]?.edgeType).toBe("redirect");
    expect(byUrl["https://example.com/c"]?.parentId).toBe(byUrl["https://example.com/b"]?.id);
    expect(byUrl["https://example.com/c"]?.status).toBe(200);
    expect(byUrl["https://example.com/c"]?.finished).toBe(true);
  });
});

describe("redirects never create a new tree", () => {
  beforeEach(() => {
    resetAssemblerSeq();
    resetTreeSeq();
  });

  it("keeps a restarted navigation (new requestId) in the same tree", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "nav-1",
      loaderId: "L1",
      frameId: "MAIN",
      request: { url: "https://example.com/old", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleResponseReceived({
      requestId: "nav-1",
      loaderId: "L1",
      frameId: "MAIN",
      timestamp: 2,
      type: "Document",
      response: {
        url: "https://example.com/old",
        status: 302,
        headers: { Location: "https://other.example.com/new" },
      },
    })) {
      integrateNode(state, a.node);
    }

    // Chrome restarts the navigation in a new process: fresh requestId/loaderId,
    // browser-initiated initiator, no redirectResponse on the event.
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "nav-2",
      loaderId: "L2",
      frameId: "MAIN",
      request: {
        url: "https://other.example.com/new",
        method: "GET",
        headers: {},
      },
      timestamp: 3,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
    const old = [...state.nodes.values()].find((n) => n.url.endsWith("/old"))!;
    const next = [...state.nodes.values()].find((n) => n.url.endsWith("/new"))!;
    expect(next.parentId).toBe(old.id);
    expect(next.edgeType).toBe("redirect");
    expect(old.children).toContain(next.id);
  });

  it("resolves a relative Location header to the same tree", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "nav-1",
      loaderId: "L1",
      frameId: "MAIN",
      request: { url: "https://example.com/from", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleResponseReceived({
      requestId: "nav-1",
      loaderId: "L1",
      frameId: "MAIN",
      timestamp: 2,
      type: "Document",
      response: {
        url: "https://example.com/from",
        status: 301,
        headers: { location: "/to" },
      },
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "nav-2",
      loaderId: "L2",
      frameId: "MAIN",
      request: { url: "https://example.com/to", method: "GET", headers: {} },
      timestamp: 3,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
    const to = [...state.nodes.values()].find((n) => n.url.endsWith("/to"))!;
    expect(to.edgeType).toBe("redirect");
  });

  it("does not root a tree for a redirect hop whose previous hop is gone", () => {
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");
    const now = Date.now();

    integrateNode(state, {
      id: "hop-2",
      requestId: "r",
      url: "https://example.com/b",
      method: "GET",
      resourceType: "Document",
      requestHeaders: {},
      responseHeaders: {},
      frameId: "MAIN",
      loaderId: "Lgone",
      targetId: "T1",
      parentId: "hop-1-deleted",
      edgeType: "redirect",
      initiator: { type: "other" },
      children: [],
      createdAt: now,
      updatedAt: now,
      hasResponse: false,
      finished: false,
    });

    expect(state.trees.size).toBe(0);
    expect(state.nodes.size).toBe(0);
  });

  it("keeps an unrelated address-bar navigation in the target's only tree", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "nav-1",
      loaderId: "L1",
      frameId: "MAIN",
      request: { url: "https://example.com/one", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleResponseReceived({
      requestId: "nav-1",
      loaderId: "L1",
      frameId: "MAIN",
      timestamp: 2,
      type: "Document",
      response: {
        url: "https://example.com/one",
        status: 200,
        headers: {},
        mimeType: "text/html",
      },
    })) {
      integrateNode(state, a.node);
    }
    // Address-bar navigation to an unrelated URL: same tab, so same tree.
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "nav-2",
      loaderId: "L2",
      frameId: "MAIN",
      request: { url: "https://example.com/two", method: "GET", headers: {} },
      timestamp: 3,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
    const one = [...state.nodes.values()].find((n) => n.url.endsWith("/one"))!;
    const two = [...state.nodes.values()].find((n) => n.url.endsWith("/two"))!;
    expect(two.parentId).toBe(one.id);
    expect(two.edgeType).toBe("other");
  });
});

describe("document + assets + fetch", () => {
  it("attaches parser children and script fetch under initiator", () => {
    const { state } = replay(loadFixture("document-assets-fetch.json"));
    expect(state.trees.size).toBe(1);
    const nodes = [...state.nodes.values()];
    const doc = nodes.find((n) => n.url === "https://example.com/")!;
    const css = nodes.find((n) => n.url.endsWith("app.css"))!;
    const js = nodes.find((n) => n.url.endsWith("app.js"))!;
    const api = nodes.find((n) => n.url.endsWith("/api/items"))!;

    expect(css.parentId).toBe(doc.id);
    expect(css.edgeType).toBe("parser");
    expect(js.parentId).toBe(doc.id);
    expect(js.edgeType).toBe("parser");
    expect(api.parentId).toBe(js.id);
    expect(api.edgeType).toBe("script");
    expect(doc.children).toEqual(expect.arrayContaining([css.id, js.id]));
    expect(js.children).toContain(api.id);
  });
});

describe("script_nav", () => {
  it("nests window.location-style document under prior document", () => {
    const { state } = replay(loadFixture("script-nav.json"));
    expect(state.trees.size).toBe(1);
    const start = [...state.nodes.values()].find((n) => n.url.endsWith("/start"))!;
    const next = [...state.nodes.values()].find((n) => n.url.endsWith("/next"))!;
    expect(next.parentId).toBe(start.id);
    expect(next.edgeType).toBe("script_nav");
    expect(start.children).toContain(next.id);
  });
});

describe("user_interaction", () => {
  it("attaches post-click assets under the new document, not the old root", () => {
    resetAssemblerSeq();
    resetTreeSeq();
    const assembler = new RrAssembler("T1");
    const state = createTreeState();

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "home",
      loaderId: "L0",
      frameId: "F1",
      request: { url: "https://example.com/home", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    recordGesture(state, {
      ts: Date.now(),
      kind: "click",
      targetId: "T1",
    });
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "next",
      loaderId: "L1",
      frameId: "F1", // same main frame as previous page
      request: { url: "https://example.com/next", method: "GET", headers: {} },
      timestamp: 2,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "css",
      loaderId: "L1",
      frameId: "F1",
      request: {
        url: "https://example.com/next.css",
        method: "GET",
        headers: {},
      },
      timestamp: 3,
      initiator: { type: "parser", url: "https://example.com/next" },
      type: "Stylesheet",
    })) {
      integrateNode(state, a.node);
    }
    // Asset with initiator pointing at the OLD document request must still
    // follow loaderId to the new page.
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "img",
      loaderId: "L1",
      frameId: "F1",
      request: {
        url: "https://example.com/pic.png",
        method: "GET",
        headers: {},
      },
      timestamp: 4,
      initiator: { type: "parser", requestId: "home" },
      type: "Image",
    })) {
      integrateNode(state, a.node);
    }

    const home = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/home"),
    )!;
    const next = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/next"),
    )!;
    const css = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/next.css"),
    )!;
    const img = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/pic.png"),
    )!;
    expect(next.parentId).toBe(home.id);
    expect(next.edgeType).toBe("user_interaction");
    expect(css.parentId).toBe(next.id);
    expect(img.parentId).toBe(next.id);
    expect(home.children).not.toContain(css.id);
    expect(home.children).not.toContain(img.id);
  });

  it("attributes click-driven document as user_interaction child", () => {
    resetAssemblerSeq();
    resetTreeSeq();
    const assembler = new RrAssembler("T1");
    const state = createTreeState();

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "d1",
      loaderId: "L1",
      frameId: "F1",
      request: { url: "https://example.com/home", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleResponseReceived({
      requestId: "d1",
      loaderId: "L1",
      frameId: "F1",
      timestamp: 2,
      type: "Document",
      response: {
        url: "https://example.com/home",
        status: 200,
        headers: {},
        mimeType: "text/html",
      },
    })) {
      integrateNode(state, a.node);
    }

    recordGesture(state, {
      ts: Date.now(),
      kind: "click",
      targetId: "T1",
      frameId: "F1",
    });

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "d2",
      loaderId: "L2",
      frameId: "F1",
      request: { url: "https://example.com/clicked", method: "GET", headers: {} },
      timestamp: 3,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }

    const home = [...state.nodes.values()].find((n) => n.url.endsWith("/home"))!;
    const clicked = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/clicked"),
    )!;
    expect(state.trees.size).toBe(1);
    expect(clicked.parentId).toBe(home.id);
    expect(clicked.edgeType).toBe("user_interaction");
  });
});

describe("RrAssembler request body", () => {
  it("captures postData on requestWillBeSent", () => {
    resetAssemblerSeq();
    const assembler = new RrAssembler();
    const events = assembler.handleRequestWillBeSent({
      requestId: "post-1",
      request: {
        url: "https://example.com/api",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        postData: '{"a":1}',
        hasPostData: true,
      },
      timestamp: 1,
      initiator: { type: "script" },
      type: "Fetch",
    });
    expect(events[0]!.node.requestBody?.text).toBe('{"a":1}');
    expect(events[0]!.node.requestHeaders["Content-Type"]).toBe(
      "application/json",
    );
  });
});

describe("duplicate Document roots", () => {
  it("merges provisional same-URL roots and prunes empties when one grows", () => {
    resetAssemblerSeq();
    resetTreeSeq();
    const assembler = new RrAssembler("T1");
    const state = createTreeState();

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "r1",
      loaderId: "L1",
      frameId: "F1",
      request: { url: "https://example.com/page", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "r2",
      loaderId: "L2",
      frameId: "F1",
      request: { url: "https://example.com/page", method: "GET", headers: {} },
      timestamp: 2,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "r3",
      loaderId: "L3",
      frameId: "F1",
      request: { url: "https://example.com/page", method: "GET", headers: {} },
      timestamp: 3,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    // All three provisional Documents collapse into one root tree.
    expect(state.trees.size).toBe(1);
    const root = [...state.nodes.values()].find(
      (n) => n.resourceType === "Document" && !n.parentId,
    )!;
    expect(root.url).toBe("https://example.com/page");

    // Attach a child to the surviving root (via loader fallback after mapping).
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "css-1",
      loaderId: "L1",
      frameId: "F1",
      request: {
        url: "https://example.com/app.css",
        method: "GET",
        headers: {},
      },
      timestamp: 4,
      initiator: { type: "parser" },
      type: "Stylesheet",
    })) {
      integrateNode(state, a.node);
    }
    expect(state.trees.size).toBe(1);
    const grown = state.nodes.get(root.id)!;
    expect(grown.children.length).toBeGreaterThanOrEqual(1);
  });

  it("folds a late empty root into an already-grown same-URL document", () => {
    resetAssemblerSeq();
    resetTreeSeq();
    const assembler = new RrAssembler("T1");
    const state = createTreeState();

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "real",
      loaderId: "Lreal",
      frameId: "F1",
      request: { url: "https://example.com/late", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "asset",
      loaderId: "Lreal",
      frameId: "F1",
      request: {
        url: "https://example.com/late.css",
        method: "GET",
        headers: {},
      },
      timestamp: 2,
      initiator: { type: "parser" },
      type: "Stylesheet",
    })) {
      integrateNode(state, a.node);
    }
    expect(state.trees.size).toBe(1);

    // Chrome often emits another Document for the same URL after assets start.
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "dup",
      loaderId: "Ldup",
      frameId: "F1",
      request: { url: "https://example.com/late", method: "GET", headers: {} },
      timestamp: 3,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    expect(state.trees.size).toBe(1);
    const docs = [...state.nodes.values()].filter(
      (n) =>
        n.resourceType === "Document" &&
        n.url === "https://example.com/late" &&
        !n.parentId,
    );
    expect(docs.length).toBe(1);
  });

  it("deletes failed empty Document roots", () => {
    resetAssemblerSeq();
    resetTreeSeq();
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "fail-1",
      loaderId: "Lx",
      frameId: "Fx",
      request: {
        url: "https://example.com/gone",
        method: "GET",
        headers: {},
      },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    expect(state.trees.size).toBe(1);
    for (const a of assembler.handleLoadingFailed({
      requestId: "fail-1",
      timestamp: 2,
      errorText: "net::ERR_ABORTED",
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    expect(state.trees.size).toBe(0);
  });
});

describe("root creation policy", () => {
  beforeEach(() => {
    resetAssemblerSeq();
    resetTreeSeq();
  });

  function docRequest(
    overrides: Partial<CdpRequestWillBeSent> & { requestId: string },
  ): CdpRequestWillBeSent {
    return {
      loaderId: "L1",
      frameId: "MAIN",
      request: { url: "https://example.com/page", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
      ...overrides,
    } as CdpRequestWillBeSent;
  }

  it("roots a tree for a top-level address-bar navigation", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({ requestId: "typed" }),
    )) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
    const root = [...state.nodes.values()][0]!;
    expect(root.parentId).toBeUndefined();
    expect(root.url).toBe("https://example.com/page");
  });

  it("does not root a tree for a subframe Document with no known page", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({
        requestId: "iframe",
        frameId: "SUB",
        loaderId: "Lsub",
        request: {
          url: "https://ads.example.com/frame.html",
          method: "GET",
          headers: {},
        },
      }),
    )) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(0);
    expect(state.nodes.size).toBe(0);
  });

  it("nests a subframe Document under the page document", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({ requestId: "page" }),
    )) {
      integrateNode(state, a.node);
    }
    for (const a of assembler.handleRequestWillBeSent(
      docRequest({
        requestId: "iframe",
        frameId: "SUB",
        loaderId: "L1",
        timestamp: 2,
        request: {
          url: "https://ads.example.com/frame.html",
          method: "GET",
          headers: {},
        },
      }),
    )) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
    const page = [...state.nodes.values()].find((n) => n.url.endsWith("/page"))!;
    const frame = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/frame.html"),
    )!;
    expect(frame.parentId).toBe(page.id);
  });

  it("drops orphan subresources instead of rooting a tree", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "orphan-css",
      loaderId: "Lunknown",
      frameId: "SUB",
      request: {
        url: "https://example.com/orphan.css",
        method: "GET",
        headers: {},
      },
      timestamp: 1,
      initiator: { type: "parser" },
      type: "Stylesheet",
    })) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(0);
    expect(state.nodes.size).toBe(0);
  });

  it("roots a tree when a gesture navigates a page that has no root yet", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");
    recordGesture(state, { ts: Date.now(), kind: "click", targetId: "T1" });

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({
        requestId: "clicked",
        request: {
          url: "https://example.com/clicked",
          method: "GET",
          headers: {},
        },
      }),
    )) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
    const root = [...state.nodes.values()][0]!;
    expect(root.edgeType).toBe("user_interaction");
    expect(root.parentId).toBeUndefined();
  });

  it("does not root a second tree when a gesture navigates a tracked page", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({ requestId: "page" }),
    )) {
      integrateNode(state, a.node);
    }
    recordGesture(state, { ts: Date.now(), kind: "click", targetId: "T1" });
    for (const a of assembler.handleRequestWillBeSent(
      docRequest({
        requestId: "clicked",
        loaderId: "L2",
        timestamp: 2,
        request: {
          url: "https://example.com/clicked",
          method: "GET",
          headers: {},
        },
      }),
    )) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
    const page = [...state.nodes.values()].find((n) => n.url.endsWith("/page"))!;
    const clicked = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/clicked"),
    )!;
    expect(clicked.parentId).toBe(page.id);
    expect(clicked.edgeType).toBe("user_interaction");
  });

  it("keeps one tree per target across repeated navigations", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (let i = 0; i < 4; i += 1) {
      for (const a of assembler.handleRequestWillBeSent(
        docRequest({
          requestId: `nav-${i}`,
          loaderId: `L${i}`,
          timestamp: i + 1,
          request: {
            url: `https://example.com/page-${i}`,
            method: "GET",
            headers: {},
          },
        }),
      )) {
        integrateNode(state, a.node);
      }
    }

    expect(state.trees.size).toBe(1);
    expect(state.nodes.size).toBe(4);
  });

  it("roots a new tree again after the target's tree is deleted", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({ requestId: "first" }),
    )) {
      integrateNode(state, a.node);
    }
    const treeId = [...state.trees.keys()][0]!;
    expect(deleteTree(state, treeId)).toBe(true);

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({
        requestId: "second",
        loaderId: "L2",
        timestamp: 5,
        request: {
          url: "https://example.com/again",
          method: "GET",
          headers: {},
        },
      }),
    )) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(1);
  });

  it("drops script navigations with no known page document", () => {
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    setMainFrame(state, "T1", "MAIN");

    for (const a of assembler.handleRequestWillBeSent(
      docRequest({
        requestId: "script-nav",
        initiator: { type: "script" },
      }),
    )) {
      integrateNode(state, a.node);
    }

    expect(state.trees.size).toBe(0);
  });
});

describe("gesture consume", () => {
  it("attributes only the first Document to one gesture", () => {
    resetAssemblerSeq();
    resetTreeSeq();
    const assembler = new RrAssembler("T1");
    const state = createTreeState();

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "home",
      loaderId: "L0",
      frameId: "F0",
      request: { url: "https://example.com/home", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }

    recordGesture(state, {
      ts: Date.now(),
      kind: "click",
      targetId: "T1",
    });
    expect(state.recentGestures.length).toBe(1);

    for (const a of assembler.handleRequestWillBeSent({
      requestId: "nav",
      loaderId: "L1",
      frameId: "F0",
      request: { url: "https://example.com/next", method: "GET", headers: {} },
      timestamp: 2,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    expect(state.recentGestures.length).toBe(0);

    const next = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/next"),
    )!;
    expect(next.edgeType).toBe("user_interaction");

    // Later iframe Document must not also become user_interaction.
    for (const a of assembler.handleRequestWillBeSent({
      requestId: "iframe",
      loaderId: "L2",
      frameId: "F-iframe",
      request: {
        url: "https://example.com/iframe.html",
        method: "GET",
        headers: {},
      },
      timestamp: 3,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    const iframe = [...state.nodes.values()].find((n) =>
      n.url.endsWith("/iframe.html"),
    )!;
    expect(iframe.edgeType).not.toBe("user_interaction");
  });

  it("dedupes bursty identical gestures", () => {
    const state = createTreeState();
    const ts = Date.now();
    recordGesture(state, { ts, kind: "click", targetId: "T1" });
    recordGesture(state, { ts: ts + 50, kind: "click", targetId: "T1" });
    recordGesture(state, { ts: ts + 80, kind: "click", targetId: "T1" });
    expect(state.recentGestures.length).toBe(1);
  });
});

describe("deleteTree / clearTrees", () => {
  it("removes one tree and clearTrees empties the forest", () => {
    resetAssemblerSeq();
    resetTreeSeq();
    // One tree per target, so two tabs are needed for two trees.
    const tab1 = new RrAssembler("T1");
    const tab2 = new RrAssembler("T2");
    const state = createTreeState();
    for (const a of tab1.handleRequestWillBeSent({
      requestId: "d1",
      loaderId: "L1",
      frameId: "F1",
      request: { url: "https://example.com/one", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    for (const a of tab2.handleRequestWillBeSent({
      requestId: "d2",
      loaderId: "L2",
      frameId: "F2",
      request: { url: "https://example.com/two", method: "GET", headers: {} },
      timestamp: 2,
      initiator: { type: "other" },
      type: "Document",
    })) {
      integrateNode(state, a.node);
    }
    expect(state.trees.size).toBe(2);
    const [firstId, secondId] = [...state.trees.keys()];
    expect(deleteTree(state, firstId!)).toBe(true);
    expect(state.trees.has(firstId!)).toBe(false);
    expect(state.trees.has(secondId!)).toBe(true);
    expect(clearTrees(state)).toBe(1);
    expect(state.trees.size).toBe(0);
    expect(state.nodes.size).toBe(0);
  });
});

describe("RrAssembler redirect hop", () => {
  it("emits finished intermediate node then new hop", () => {
    resetAssemblerSeq();
    const assembler = new RrAssembler();
    const first = assembler.handleRequestWillBeSent({
      requestId: "r",
      request: { url: "https://a.example/", method: "GET", headers: {} },
      timestamp: 1,
      initiator: { type: "other" },
      type: "Document",
    });
    expect(first).toHaveLength(1);

    const second = assembler.handleRequestWillBeSent({
      requestId: "r",
      request: { url: "https://b.example/", method: "GET", headers: {} },
      timestamp: 2,
      initiator: { type: "other" },
      type: "Document",
      redirectResponse: {
        url: "https://a.example/",
        status: 302,
        headers: { Location: "https://b.example/" },
      },
    });
    expect(second).toHaveLength(2);
    expect(second[0]!.isRedirectHop).toBe(true);
    expect(second[0]!.node.status).toBe(302);
    expect(second[0]!.node.finished).toBe(true);
    expect(second[1]!.node.url).toBe("https://b.example/");
    expect(second[1]!.node.edgeType).toBe("redirect");
    expect(second[1]!.node.parentId).toBe(second[0]!.node.id);
  });
});
