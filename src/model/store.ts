import { EventEmitter } from "node:events";
import {
  clearTrees,
  createTreeState,
  deleteTree,
  getTreeSnapshot,
  integrateNode,
  listTrees,
  recordGesture,
  setMainFrame,
  type TreeState,
} from "./tree-builder.js";
import type { RrNode, TreePatch, UserGesture } from "./types.js";

export class TreeStore extends EventEmitter {
  readonly state: TreeState = createTreeState();

  ingest(node: RrNode): TreePatch[] {
    const patches = integrateNode(this.state, node);
    for (const p of patches) {
      this.emit("patch", p);
    }
    return patches;
  }

  setMainFrame(targetId: string, frameId: string): void {
    setMainFrame(this.state, targetId, frameId);
  }

  gesture(g: UserGesture): void {
    recordGesture(this.state, g);
    this.emit("gesture", g);
  }

  getTrees() {
    return listTrees(this.state);
  }

  getTree(treeId: string) {
    return getTreeSnapshot(this.state, treeId);
  }

  getAllNodes(): RrNode[] {
    return [...this.state.nodes.values()];
  }

  deleteTree(treeId: string): boolean {
    const ok = deleteTree(this.state, treeId);
    if (ok) {
      const patch: TreePatch = {
        op: "delete",
        treeId,
        ts: Date.now(),
      };
      this.emit("patch", patch);
    }
    return ok;
  }

  clearTrees(): number {
    const count = clearTrees(this.state);
    const patch: TreePatch = { op: "clear", ts: Date.now() };
    this.emit("patch", patch);
    return count;
  }
}
