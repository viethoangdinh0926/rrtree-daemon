import type {
  EdgeType,
  RrNode,
  Tree,
  TreePatch,
  UserGesture,
} from "./types.js";

const GESTURE_WINDOW_MS = 2000;

export interface TreeState {
  nodes: Map<string, RrNode>;
  trees: Map<string, Tree>;
  /** CDP requestId → node id (current hop). */
  requestIdToNodeId: Map<string, string>;
  /** loaderId → Document node id for that load. */
  loaderToDocument: Map<string, string>;
  /** frameId → active Document node id. */
  frameToDocument: Map<string, string>;
  /** targetId → most recent tree id (for attaching script_nav children). */
  targetToActiveTree: Map<string, string>;
  recentGestures: UserGesture[];
}

export function createTreeState(): TreeState {
  return {
    nodes: new Map(),
    trees: new Map(),
    requestIdToNodeId: new Map(),
    loaderToDocument: new Map(),
    frameToDocument: new Map(),
    targetToActiveTree: new Map(),
    recentGestures: [],
  };
}

export function recordGesture(state: TreeState, g: UserGesture): void {
  state.recentGestures.push(g);
  const cutoff = g.ts - GESTURE_WINDOW_MS * 2;
  state.recentGestures = state.recentGestures.filter((x) => x.ts >= cutoff);
}

function findRecentGesture(
  state: TreeState,
  node: RrNode,
  now: number,
): UserGesture | undefined {
  const windowStart = now - GESTURE_WINDOW_MS;
  for (let i = state.recentGestures.length - 1; i >= 0; i--) {
    const g = state.recentGestures[i]!;
    if (g.ts < windowStart) break;
    if (node.targetId && g.targetId && g.targetId !== node.targetId) continue;
    if (node.frameId && g.frameId && g.frameId !== node.frameId) continue;
    return g;
  }
  return undefined;
}

function mapInitiatorToEdge(type: string | undefined): EdgeType {
  switch (type) {
    case "parser":
      return "parser";
    case "script":
      return "script";
    case "preload":
      return "preload";
    case "redirect":
      return "redirect";
    default:
      return "other";
  }
}

function isDocument(node: RrNode): boolean {
  return node.resourceType === "Document";
}

function resolveParent(
  state: TreeState,
  node: RrNode,
): { parentId?: string; edgeType: EdgeType; newRoot: boolean } {
  // Redirect hops already carry parent/edge from assembler.
  if (node.edgeType === "redirect" && node.parentId) {
    return { parentId: node.parentId, edgeType: "redirect", newRoot: false };
  }

  const initiatorType = node.initiator?.type ?? "other";
  const initiatorReqId = node.initiator?.requestId;
  const now = node.createdAt;

  if (isDocument(node)) {
    const gesture = findRecentGesture(state, node, now);

    // Prefer recent user gesture over initiator classification (click on <a>, etc.).
    if (gesture) {
      const parentDoc =
        (node.frameId && state.frameToDocument.get(node.frameId)) ||
        findActiveDocumentForTarget(state, node.targetId);
      if (parentDoc && parentDoc !== node.id) {
        return {
          parentId: parentDoc,
          edgeType: "user_interaction",
          newRoot: false,
        };
      }
      return { newRoot: true, edgeType: "user_interaction" };
    }

    if (initiatorType === "script") {
      const parentDoc =
        (node.frameId && state.frameToDocument.get(node.frameId)) ||
        (node.loaderId && state.loaderToDocument.get(node.loaderId)) ||
        findActiveDocumentForTarget(state, node.targetId);
      if (parentDoc && parentDoc !== node.id) {
        return { parentId: parentDoc, edgeType: "script_nav", newRoot: false };
      }
    }

    // Typical address-bar / restored / link without recorded gesture.
    if (initiatorType === "other" || initiatorType === "parser") {
      return { newRoot: true, edgeType: "other" };
    }

    return { newRoot: true, edgeType: mapInitiatorToEdge(initiatorType) };
  }

  // Subresources: prefer initiator.requestId, else loaderId document, else frame document.
  if (initiatorReqId) {
    const parentFromInitiator = state.requestIdToNodeId.get(initiatorReqId);
    if (parentFromInitiator) {
      return {
        parentId: parentFromInitiator,
        edgeType: mapInitiatorToEdge(initiatorType),
        newRoot: false,
      };
    }
  }

  if (node.loaderId) {
    const doc = state.loaderToDocument.get(node.loaderId);
    if (doc) {
      return {
        parentId: doc,
        edgeType: mapInitiatorToEdge(initiatorType),
        newRoot: false,
      };
    }
  }

  if (node.frameId) {
    const doc = state.frameToDocument.get(node.frameId);
    if (doc) {
      return {
        parentId: doc,
        edgeType: mapInitiatorToEdge(initiatorType),
        newRoot: false,
      };
    }
  }

  // Orphan subresource: attach to active tree root if any, else create dangling under a synthetic root later.
  const activeTreeId = node.targetId
    ? state.targetToActiveTree.get(node.targetId)
    : undefined;
  if (activeTreeId) {
    const tree = state.trees.get(activeTreeId);
    if (tree) {
      return {
        parentId: tree.rootId,
        edgeType: mapInitiatorToEdge(initiatorType),
        newRoot: false,
      };
    }
  }

  // Last resort: new tree rooted at this node (unusual for subresources).
  return { newRoot: true, edgeType: mapInitiatorToEdge(initiatorType) };
}

function findActiveDocumentForTarget(
  state: TreeState,
  targetId?: string,
): string | undefined {
  if (!targetId) return undefined;
  const treeId = state.targetToActiveTree.get(targetId);
  if (!treeId) return undefined;
  const tree = state.trees.get(treeId);
  if (!tree) return undefined;
  // Walk for most recently updated Document under this tree.
  let best: RrNode | undefined;
  for (const n of state.nodes.values()) {
    if (n.treeId !== treeId || !isDocument(n)) continue;
    if (!best || n.updatedAt > best.updatedAt) best = n;
  }
  return best?.id ?? tree.rootId;
}

let treeSeq = 0;

function newTreeId(): string {
  treeSeq += 1;
  return `tree-${treeSeq}-${Date.now()}`;
}

/**
 * Integrate an assembled RR node into the forest. Returns patches for live clients.
 */
export function integrateNode(state: TreeState, incoming: RrNode): TreePatch[] {
  const patches: TreePatch[] = [];
  const existing = state.nodes.get(incoming.id);

  // Merge updates for known nodes (response / finish).
  if (existing) {
    const merged: RrNode = {
      ...existing,
      ...incoming,
      children: existing.children,
      parentId: existing.parentId ?? incoming.parentId,
      edgeType: existing.edgeType ?? incoming.edgeType,
      treeId: existing.treeId,
    };
    state.nodes.set(merged.id, merged);
    state.requestIdToNodeId.set(merged.requestId, merged.id);
    if (merged.treeId) {
      const tree = state.trees.get(merged.treeId);
      if (tree) {
        tree.updatedAt = merged.updatedAt;
        patches.push({
          op: "upsert",
          treeId: merged.treeId,
          node: clone(merged),
          ts: Date.now(),
        });
      }
    }
    return patches;
  }

  const { parentId, edgeType, newRoot } = resolveParent(state, incoming);
  const node: RrNode = {
    ...incoming,
    parentId: parentId ?? incoming.parentId,
    edgeType: incoming.edgeType ?? edgeType,
    children: [],
  };

  if (newRoot || !node.parentId || !state.nodes.has(node.parentId)) {
    const treeId = newTreeId();
    node.treeId = treeId;
    node.parentId = undefined;
    // Keep edgeType for roots that came from user_interaction for UI hints.
    const tree: Tree = {
      id: treeId,
      rootId: node.id,
      targetId: node.targetId,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
    state.trees.set(treeId, tree);
    if (node.targetId) state.targetToActiveTree.set(node.targetId, treeId);
    state.nodes.set(node.id, node);
    state.requestIdToNodeId.set(node.requestId, node.id);
    indexDocument(state, node);
    patches.push({
      op: "upsert",
      treeId,
      node: clone(node),
      ts: Date.now(),
    });
    return patches;
  }

  const parent = state.nodes.get(node.parentId)!;
  node.treeId = parent.treeId;
  if (!parent.children.includes(node.id)) {
    parent.children.push(node.id);
  }
  parent.updatedAt = node.updatedAt;
  state.nodes.set(parent.id, parent);
  state.nodes.set(node.id, node);
  state.requestIdToNodeId.set(node.requestId, node.id);
  indexDocument(state, node);

  if (node.treeId) {
    const tree = state.trees.get(node.treeId);
    if (tree) {
      tree.updatedAt = node.updatedAt;
      if (node.targetId) state.targetToActiveTree.set(node.targetId, node.treeId);
    }
    patches.push({
      op: "attach",
      treeId: node.treeId,
      node: clone(node),
      ts: Date.now(),
    });
    patches.push({
      op: "upsert",
      treeId: node.treeId,
      node: clone(parent),
      ts: Date.now(),
    });
  }

  return patches;
}

function indexDocument(state: TreeState, node: RrNode): void {
  if (!isDocument(node)) return;
  if (node.loaderId) state.loaderToDocument.set(node.loaderId, node.id);
  if (node.frameId) state.frameToDocument.set(node.frameId, node.id);
}

function clone(n: RrNode): RrNode {
  return {
    ...n,
    children: [...n.children],
    requestHeaders: { ...n.requestHeaders },
    responseHeaders: { ...n.responseHeaders },
    initiator: n.initiator ? { ...n.initiator } : undefined,
  };
}

export function getTreeSnapshot(state: TreeState, treeId: string) {
  const tree = state.trees.get(treeId);
  if (!tree) return undefined;
  const nodes: RrNode[] = [];
  for (const n of state.nodes.values()) {
    if (n.treeId === treeId) nodes.push(clone(n));
  }
  return { tree: { ...tree }, nodes };
}

export function listTrees(state: TreeState) {
  return [...state.trees.values()].map((t) => ({ ...t }));
}

export function resetTreeSeq(): void {
  treeSeq = 0;
}
