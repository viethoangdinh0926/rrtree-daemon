import type {
  EdgeType,
  RrNode,
  Tree,
  TreePatch,
  UserGesture,
} from "./types.js";

const GESTURE_WINDOW_MS = 2000;
/** Ignore duplicate click/keydown hooks from the same physical action. */
const GESTURE_DEDUP_MS = 400;
/** Collapse duplicate empty Document roots for the same URL within this window. */
const ROOT_DEDUP_MS = 15_000;

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
  /** Duplicate provisional node ids → canonical node id. */
  nodeIdAlias: Map<string, string>;
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
    nodeIdAlias: new Map(),
    recentGestures: [],
  };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

function resolveCanonicalId(state: TreeState, id: string): string {
  let cur = id;
  const seen = new Set<string>();
  while (state.nodeIdAlias.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    cur = state.nodeIdAlias.get(cur)!;
  }
  return cur;
}

/**
 * Find an existing Document for the same URL/target to absorb a provisional load.
 * Prefers a Document that already has children (the real navigation), including
 * redirect-chain finals that are not tree.rootId.
 */
function findCanonicalDocument(
  state: TreeState,
  node: RrNode,
): RrNode | undefined {
  if (!isDocument(node)) return undefined;
  const url = normalizeUrl(node.url);
  const now = node.createdAt;
  let best: RrNode | undefined;
  let bestScore = -1;
  for (const cand of state.nodes.values()) {
    if (!isDocument(cand)) continue;
    if (cand.id === node.id) continue;
    if (node.targetId && cand.targetId && cand.targetId !== node.targetId) {
      continue;
    }
    if (normalizeUrl(cand.url) !== url) continue;
    // Only absorb Chrome provisional duplicates for an in-flight navigation.
    if (now - cand.createdAt > ROOT_DEDUP_MS) continue;
    // Higher score = prefer grown docs, then docs already in a tree, then older.
    const score =
      cand.children.length * 1_000_000 +
      (cand.treeId ? 10_000 : 0) +
      (cand.hasResponse ? 100 : 0) +
      Math.max(0, ROOT_DEDUP_MS - (now - cand.createdAt));
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/**
 * Delete empty Document-root trees whose URL matches `keep` (or any grown
 * same-URL Document in keep's target). Surviving tree is the one that grew.
 */
function pruneEmptyDuplicateRoots(
  state: TreeState,
  keep: RrNode,
): TreePatch[] {
  if (!isDocument(keep)) return [];
  const url = normalizeUrl(keep.url);
  const patches: TreePatch[] = [];
  for (const tree of [...state.trees.values()]) {
    if (keep.treeId && tree.id === keep.treeId) continue;
    if (keep.targetId && tree.targetId && tree.targetId !== keep.targetId) {
      continue;
    }
    const root = state.nodes.get(tree.rootId);
    if (!root || !isDocument(root)) continue;
    // Empty root whose URL equals keep, OR empty root while keep is same-URL grown doc.
    const rootUrl = normalizeUrl(root.url);
    if (rootUrl !== url) continue;
    if (root.children.length > 0) continue;
    // Never delete the tree that contains the canonical keep node.
    if (keep.treeId && tree.id === keep.treeId) continue;
    if (tree.rootId === keep.id) continue;
    if (deleteTree(state, tree.id)) {
      patches.push({ op: "delete", treeId: tree.id, ts: Date.now() });
    }
  }
  return patches;
}

/** After any Document activity, drop leftover empty same-URL root trees. */
function pruneEmptyRootsForUrl(
  state: TreeState,
  url: string,
  targetId?: string,
): TreePatch[] {
  const norm = normalizeUrl(url);
  // Prefer keeping a tree that has a grown Document for this URL.
  let keep: RrNode | undefined;
  for (const n of state.nodes.values()) {
    if (!isDocument(n)) continue;
    if (normalizeUrl(n.url) !== norm) continue;
    if (targetId && n.targetId && n.targetId !== targetId) continue;
    if (!keep) keep = n;
    else if (n.children.length > keep.children.length) keep = n;
    else if (
      n.children.length === keep.children.length &&
      (n.hasResponse && !keep.hasResponse)
    ) {
      keep = n;
    }
  }
  if (!keep) return [];
  // If nothing has grown yet, keep the oldest root and prune other empties.
  return pruneEmptyDuplicateRoots(state, keep);
}

function mergeIntoCanonical(
  state: TreeState,
  canonical: RrNode,
  incoming: RrNode,
): RrNode {
  if (incoming.id !== canonical.id) {
    state.nodeIdAlias.set(incoming.id, canonical.id);
  }
  const merged: RrNode = {
    ...canonical,
    ...incoming,
    id: canonical.id,
    children: canonical.children,
    parentId: canonical.parentId,
    edgeType: canonical.edgeType ?? incoming.edgeType,
    treeId: canonical.treeId,
    createdAt: canonical.createdAt,
    requestHeaders: {
      ...canonical.requestHeaders,
      ...incoming.requestHeaders,
    },
    responseHeaders: {
      ...canonical.responseHeaders,
      ...incoming.responseHeaders,
    },
    requestBody: incoming.requestBody ?? canonical.requestBody,
    responseBody: incoming.responseBody ?? canonical.responseBody,
    bodyPreview: incoming.bodyPreview ?? canonical.bodyPreview,
    bodyRef: incoming.bodyRef ?? canonical.bodyRef,
  };
  state.nodes.set(merged.id, merged);
  state.requestIdToNodeId.set(incoming.requestId, merged.id);
  state.requestIdToNodeId.set(merged.requestId, merged.id);
  indexDocument(state, merged);
  if (merged.treeId) {
    const tree = state.trees.get(merged.treeId);
    if (tree) {
      tree.updatedAt = merged.updatedAt;
      if (merged.targetId) {
        state.targetToActiveTree.set(merged.targetId, merged.treeId);
      }
    }
  }
  return merged;
}

export function recordGesture(state: TreeState, g: UserGesture): void {
  const last = state.recentGestures[state.recentGestures.length - 1];
  if (
    last &&
    last.kind === g.kind &&
    last.targetId === g.targetId &&
    g.ts - last.ts < GESTURE_DEDUP_MS
  ) {
    // Same physical interaction reported multiple times (frames / double hook).
    return;
  }
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

/** One Document navigation consumes the gesture so iframes/follow-ups are not re-tagged. */
function consumeGesture(state: TreeState, gesture: UserGesture): void {
  const idx = state.recentGestures.lastIndexOf(gesture);
  if (idx >= 0) state.recentGestures.splice(idx, 1);
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
    // Consume after first Document so one click does not tag every iframe Document.
    if (gesture) {
      consumeGesture(state, gesture);
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

  // Follow aliases for folded provisional nodes. Do NOT map by requestId alone:
  // Chrome redirect hops reuse the same CDP requestId with new node identities.
  const aliased = resolveCanonicalId(state, incoming.id);
  const byRequest = state.requestIdToNodeId.get(incoming.requestId);
  let canonicalIncomingId = aliased;
  if (
    byRequest &&
    (byRequest === incoming.id ||
      byRequest === aliased ||
      resolveCanonicalId(state, byRequest) === aliased)
  ) {
    canonicalIncomingId = resolveCanonicalId(state, byRequest);
  }
  const working: RrNode =
    canonicalIncomingId !== incoming.id
      ? { ...incoming, id: canonicalIncomingId }
      : incoming;

  const existing = state.nodes.get(working.id);

  // Merge updates for known nodes (response / finish).
  if (existing) {
    const merged = mergeIntoCanonical(state, existing, working);
    if (merged.treeId) {
      patches.push({
        op: "upsert",
        treeId: merged.treeId,
        node: clone(merged),
        ts: Date.now(),
      });
    }
    // Cancelled provisional Document roots with no children → drop the tree.
    if (
      merged.failed &&
      merged.finished &&
      isDocument(merged) &&
      !merged.parentId &&
      merged.children.length === 0 &&
      merged.treeId
    ) {
      const treeId = merged.treeId;
      if (deleteTree(state, treeId)) {
        patches.push({ op: "delete", treeId, ts: Date.now() });
      }
      return patches;
    }
    if (isDocument(merged)) {
      patches.push(
        ...pruneEmptyRootsForUrl(state, merged.url, merged.targetId),
      );
    }
    return patches;
  }

  // Provisional Document for a URL we already track → fold into that Document.
  if (isDocument(working)) {
    const canonical = findCanonicalDocument(state, working);
    if (canonical) {
      const merged = mergeIntoCanonical(state, canonical, working);
      if (merged.treeId) {
        patches.push({
          op: "upsert",
          treeId: merged.treeId,
          node: clone(merged),
          ts: Date.now(),
        });
      }
      patches.push(
        ...pruneEmptyRootsForUrl(state, merged.url, merged.targetId),
      );
      return patches;
    }
  }

  const { parentId, edgeType, newRoot } = resolveParent(state, working);
  const node: RrNode = {
    ...working,
    parentId: parentId ?? working.parentId,
    edgeType: working.edgeType ?? edgeType,
    children: [],
  };

  if (newRoot || !node.parentId || !state.nodes.has(node.parentId)) {
    const treeId = newTreeId();
    node.treeId = treeId;
    node.parentId = undefined;
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
    if (isDocument(node)) {
      patches.push(...pruneEmptyRootsForUrl(state, node.url, node.targetId));
    }
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
    // Prune empty same-URL roots against the nearest Document ancestor.
    let doc: RrNode | undefined = isDocument(parent)
      ? parent
      : state.nodes.get(parent.parentId ?? "");
    while (doc && !isDocument(doc) && doc.parentId) {
      doc = state.nodes.get(doc.parentId);
    }
    if (doc && isDocument(doc)) {
      patches.push(...pruneEmptyRootsForUrl(state, doc.url, doc.targetId));
    }
    // Also prune by tree root Document URL when redirect chain differs.
    const treeRoot = tree ? state.nodes.get(tree.rootId) : undefined;
    if (treeRoot && isDocument(treeRoot) && treeRoot.id !== doc?.id) {
      patches.push(
        ...pruneEmptyRootsForUrl(state, treeRoot.url, treeRoot.targetId),
      );
    }
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
    requestBody: n.requestBody ? { ...n.requestBody } : undefined,
    responseBody: n.responseBody ? { ...n.responseBody } : undefined,
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

/** Remove one tree and all of its nodes; returns false if unknown. */
export function deleteTree(state: TreeState, treeId: string): boolean {
  if (!state.trees.has(treeId)) return false;

  const nodeIds: string[] = [];
  for (const [id, n] of state.nodes) {
    if (n.treeId === treeId) nodeIds.push(id);
  }

  const requestIds: string[] = [];
  for (const id of nodeIds) {
    const n = state.nodes.get(id)!;
    requestIds.push(n.requestId);
    if (n.loaderId && state.loaderToDocument.get(n.loaderId) === id) {
      state.loaderToDocument.delete(n.loaderId);
    }
    if (n.frameId && state.frameToDocument.get(n.frameId) === id) {
      state.frameToDocument.delete(n.frameId);
    }
    state.nodes.delete(id);
  }

  for (const [reqId, nodeId] of [...state.requestIdToNodeId.entries()]) {
    if (nodeIds.includes(nodeId)) state.requestIdToNodeId.delete(reqId);
  }

  for (const [targetId, activeTreeId] of [
    ...state.targetToActiveTree.entries(),
  ]) {
    if (activeTreeId === treeId) state.targetToActiveTree.delete(targetId);
  }

  for (const [alias, canonical] of [...state.nodeIdAlias.entries()]) {
    if (nodeIds.includes(alias) || nodeIds.includes(canonical)) {
      state.nodeIdAlias.delete(alias);
    }
  }

  state.trees.delete(treeId);
  return true;
}

/** Remove every tree and reset indexes (keeps recentGestures). */
export function clearTrees(state: TreeState): number {
  const count = state.trees.size;
  state.nodes.clear();
  state.trees.clear();
  state.requestIdToNodeId.clear();
  state.loaderToDocument.clear();
  state.frameToDocument.clear();
  state.targetToActiveTree.clear();
  state.nodeIdAlias.clear();
  return count;
}

export function resetTreeSeq(): void {
  treeSeq = 0;
}
