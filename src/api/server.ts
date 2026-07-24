import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Express } from "express";
import type { CdpManager } from "../cdp/session.js";
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
  app.use(express.static(uiDir));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      attachedTargets: opts.cdp.getAttachedTargetIds(),
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
    res.json(snap);
  });

  app.get("/nodes", (_req, res) => {
    res.json({ nodes: opts.store.getAllNodes() });
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

  app.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (patch: TreePatch) => {
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
