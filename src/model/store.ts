import { EventEmitter } from "node:events";
import {
  createTreeState,
  getTreeSnapshot,
  integrateNode,
  listTrees,
  recordGesture,
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
}
