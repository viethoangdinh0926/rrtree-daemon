import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Express } from "express";
import type { CdpManager } from "../cdp/session.js";
import { nodeToCurl } from "../model/curl.js";
import type { TreeStore } from "../model/store.js";
import type { TreePatch } from "../model/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveUiDir(): string {
  const candidates = [
    path.resolve(__dirname, "../ui"),
    path.resolve(__dirname, "../../src/ui"),
    path.resolve(process.cwd(), "src/ui"),
    path.resolve(process.cwd(), "dist/ui"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return candidates[0]!;
}

export interface ApiOptions {
  store: TreeStore;
  cdp: CdpManager;
  port?: number;
}

export function createApp(opts: ApiOptions): Express {
  const app = express();
  app.use(express.json());

  const uiDir = resolveUiDir();
  app.use(express.static(uiDir, {
    setHeaders: (res, path) => {
      // Disable caching for HTML files to force browser reload
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));

  app.get("/health", (_req, res) => {
    const cdp = opts.cdp.getStatus();
    res.json({
      ok: true,
      cdp: {
        state: cdp.state,
        host: cdp.host,
        port: cdp.port,
        lastError: cdp.lastError,
        capturing: cdp.capturing,
      },
      attachedTargets: cdp.attachedTargets,
      treeCount: opts.store.getTrees().length,
    });
  });

  app.get("/trees", (_req, res) => {
    res.json({ trees: opts.store.getTrees() });
  });

  app.get("/trees/:id", (req, res) => {
    const snap = opts.store.getTree(req.params.id);
    if (!snap) {
      res.status(404).json({ error: "tree not found" });
      return;
    }
    res.json({ tree: snap.tree, nodes: snap.nodes });
  });

  app.delete("/trees/:id", (req, res) => {
    const ok = opts.store.deleteTree(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "tree not found" });
      return;
    }
    res.json({ ok: true, treeId: req.params.id });
  });

  app.delete("/trees", (_req, res) => {
    const deleted = opts.store.clearTrees();
    res.json({ ok: true, deleted });
  });

  app.get("/nodes", (_req, res) => {
    res.json({ nodes: opts.store.getAllNodes() });
  });

  app.get("/nodes/:id", (req, res) => {
    const node = opts.store.getAllNodes().find((n) => n.id === req.params.id);
    if (!node) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    res.json({ node });
  });

  app.get("/nodes/:id/curl", (req, res) => {
    const node = opts.store.getAllNodes().find((n) => n.id === req.params.id);
    if (!node) {
      res.status(404).json({ error: "node not found" });
      return;
    }
    const curl = nodeToCurl(node);
    res.json({ curl, nodeId: node.id });
  });

  app.post("/attach", async (req, res) => {
    const targetId = req.body?.targetId as string | undefined;
    if (!targetId) {
      res.status(400).json({ error: "targetId required" });
      return;
    }
    const ok = await opts.cdp.attachTarget(targetId);
    res.json({ ok, attachedTargets: opts.cdp.getAttachedTargetIds() });
  });

  app.get("/capturing", (_req, res) => {
    res.json({ capturing: opts.cdp.isCapturing() });
  });

  app.post("/capturing", (req, res) => {
    const enabled = req.body?.enabled as boolean | undefined;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) required" });
      return;
    }
    opts.cdp.setCapturing(enabled);
    res.json({ capturing: enabled });
  });

  app.post("/trees/:id/effective-root", (req, res) => {
    const { effectiveRootId } = req.body as { effectiveRootId?: string };
    if (!effectiveRootId) {
      res.status(400).json({ error: "effectiveRootId required" });
      return;
    }
    const ok = opts.store.setEffectiveRoot(req.params.id, effectiveRootId);
    if (!ok) {
      res.status(404).json({ error: "tree or node not found" });
      return;
    }
    res.json({ ok: true, treeId: req.params.id, effectiveRootId });
  });

  app.delete("/trees/:id/effective-root", (req, res) => {
    const ok = opts.store.clearEffectiveRoot(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "tree not found" });
      return;
    }
    res.json({ ok: true, treeId: req.params.id });
  });

  app.get("/trees/:id/json", (req, res) => {
    const json = opts.store.generateTreeJson(req.params.id);
    if (!json) {
      res.status(404).json({ error: "tree not found" });
      return;
    }
    res.json({ json });
  });

  app.get("/nodes/:id/partial-json", (req, res) => {
    const filtersParam = req.query.filters as string | undefined;
    const edgeTypeFilters = filtersParam ? new Set(filtersParam.split(",")) : undefined;
    const json = opts.store.generatePartialTreeJson(req.params.id, edgeTypeFilters);
    if (!json) {
      res.status(400).json({ error: "Cannot generate JSON: selected node is not under the effective root" });
      return;
    }
    res.json({ json });
  });

  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (patch: TreePatch | { op: string; trees?: unknown }) => {
      res.write(`data: ${JSON.stringify(patch)}\n\n`);
    };

    // Snapshot hint so clients can refresh.
    res.write(
      `data: ${JSON.stringify({ op: "snapshot", trees: opts.store.getTrees() })}\n\n`,
    );

    const onPatch = (patch: TreePatch) => send(patch);
    opts.store.on("patch", onPatch);

    const heartbeat = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      opts.store.off("patch", onPatch);
    });
  });

  return app;
}

export async function startServer(opts: ApiOptions): Promise<{ port: number }> {
  const port = opts.port ?? Number(process.env.PORT ?? 7733);
  const app = createApp(opts);
  await new Promise<void>((resolve) => {
    app.listen(port, "127.0.0.1", () => resolve());
  });
  console.log(`[api] listening on http://127.0.0.1:${port}`);
  return { port };
}
