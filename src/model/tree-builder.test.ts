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
    const assembler = new RrAssembler("T1");
    const state = createTreeState();
    for (const a of assembler.handleRequestWillBeSent({
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
    for (const a of assembler.handleRequestWillBeSent({
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
