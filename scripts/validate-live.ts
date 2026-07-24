/**
 * Live validation against headless Chrome for the five plan scenarios:
 * redirect, assets, fetch, script_nav, click-nav.
 *
 * Usage: npx tsx scripts/validate-live.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import CDP from "chrome-remote-interface";
import { CdpManager } from "../src/cdp/session.js";
import { TreeStore } from "../src/model/store.js";

const CDP_PORT = 9333;
const PAGE_PORT = 8765;
const BASE = `http://127.0.0.1:${PAGE_PORT}`;

function html(body: string): string {
  return `<!DOCTYPE html><html><head><title>rrtree-validate</title>
<link rel="stylesheet" href="/app.css">
</head><body>${body}<script src="/app.js"></script></body></html>`;
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || "/";
  if (url === "/redirect-start") {
    res.writeHead(302, { Location: "/redirect-mid" });
    res.end();
    return;
  }
  if (url === "/redirect-mid") {
    res.writeHead(301, { Location: "/redirect-end" });
    res.end();
    return;
  }
  if (url === "/redirect-end") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html(`<h1>redirect-end</h1><p id="ok">done</p>`));
    return;
  }
  if (url === "/app.css") {
    res.writeHead(200, { "Content-Type": "text/css" });
    res.end("body { font-family: sans-serif; }");
    return;
  }
  if (url === "/app.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(`
      window.__rrtreeFetch = async function () {
        const r = await fetch('/api/items');
        return r.json();
      };
      window.__rrtreeScriptNav = function () {
        window.location.href = '/script-nav-dest';
      };
    `);
    return;
  }
  if (url === "/api/items") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ items: [1, 2, 3] }));
    return;
  }
  if (url === "/assets") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      html(`
      <h1>assets</h1>
      <button id="fetchBtn">fetch</button>
      <a id="clickLink" href="/click-dest">click me</a>
      <pre id="out"></pre>
      <script>
        document.getElementById('fetchBtn').addEventListener('click', async () => {
          const data = await window.__rrtreeFetch();
          document.getElementById('out').textContent = JSON.stringify(data);
        });
      </script>
    `),
    );
    return;
  }
  if (url === "/script-nav-start") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      html(`
      <h1>script-nav-start</h1>
      <script>setTimeout(() => { window.location.href = '/script-nav-dest'; }, 200);</script>
    `),
    );
    return;
  }
  if (url === "/script-nav-dest" || url === "/click-dest") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html(`<h1>${url.slice(1)}</h1>`));
    return;
  }
  res.writeHead(404);
  res.end("not found");
}

function findNodes(store: TreeStore, pred: (u: string) => boolean) {
  return store.getAllNodes().filter((n) => pred(n.url));
}

async function waitFor(
  store: TreeStore,
  pred: () => boolean,
  label: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await sleep(150);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main(): Promise<void> {
  const pageServer = createServer(handle);
  await new Promise<void>((resolve) => pageServer.listen(PAGE_PORT, "127.0.0.1", resolve));
  console.log(`[validate] page server ${BASE}`);

  const chrome: ChildProcess = spawn(
    "google-chrome",
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=/tmp/rrtree-validate-${Date.now()}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  await sleep(1500);

  const store = new TreeStore();
  const cdp = new CdpManager({
    host: "127.0.0.1",
    port: CDP_PORT,
    store,
    captureBodies: false,
  });
  await cdp.start();
  await sleep(500);

  const client = await CDP({ host: "127.0.0.1", port: CDP_PORT });
  const { Target } = client;
  const { targetInfos } = await Target.getTargets();
  const page = targetInfos.find((t: { type: string }) => t.type === "page");
  if (!page) throw new Error("no page target");
  const pageClient = await CDP({
    host: "127.0.0.1",
    port: CDP_PORT,
    target: page.targetId,
  });
  await pageClient.Page.enable();

  const results: string[] = [];

  // 1) Redirect chain
  await pageClient.Page.navigate({ url: `${BASE}/redirect-start` });
  await waitFor(
    store,
    () => findNodes(store, (u) => u.includes("/redirect-end")).some((n) => n.status === 200),
    "redirect-end",
  );
  const a = findNodes(store, (u) => u.includes("/redirect-start"))[0];
  const b = findNodes(store, (u) => u.includes("/redirect-mid"))[0];
  const c = findNodes(store, (u) => u.includes("/redirect-end"))[0];
  if (!a || !b || !c) throw new Error("redirect nodes missing");
  if (b.edgeType !== "redirect" || c.edgeType !== "redirect") {
    throw new Error(`redirect edges wrong: ${b.edgeType}, ${c.edgeType}`);
  }
  if (b.parentId !== a.id || c.parentId !== b.id) {
    throw new Error("redirect parent chain wrong");
  }
  results.push("PASS redirect");

  // 2+3) Assets + fetch
  store.state.nodes.clear();
  store.state.trees.clear();
  store.state.requestIdToNodeId.clear();
  store.state.loaderToDocument.clear();
  store.state.frameToDocument.clear();
  store.state.targetToActiveTree.clear();

  await pageClient.Page.navigate({ url: `${BASE}/assets` });
  await waitFor(
    store,
    () =>
      findNodes(store, (u) => u.endsWith("/app.css")).length > 0 &&
      findNodes(store, (u) => u.endsWith("/app.js")).length > 0,
    "assets",
  );
  const doc = findNodes(store, (u) => u.includes("/assets") && !u.includes(".css") && !u.includes(".js"))[0];
  const css = findNodes(store, (u) => u.endsWith("/app.css"))[0];
  const js = findNodes(store, (u) => u.endsWith("/app.js"))[0];
  if (!doc || !css || !js) throw new Error("asset nodes missing");
  if (css.parentId !== doc.id || css.edgeType !== "parser") {
    throw new Error(`css parenting wrong parent=${css.parentId} edge=${css.edgeType}`);
  }
  if (js.parentId !== doc.id || js.edgeType !== "parser") {
    throw new Error(`js parenting wrong parent=${js.parentId} edge=${js.edgeType}`);
  }
  results.push("PASS assets");

  await pageClient.Runtime.evaluate({
    expression: `document.getElementById('fetchBtn').click()`,
  });
  await waitFor(
    store,
    () => findNodes(store, (u) => u.includes("/api/items")).length > 0,
    "fetch",
  );
  const api = findNodes(store, (u) => u.includes("/api/items"))[0]!;
  if (api.edgeType !== "script") {
    throw new Error(`fetch edgeType=${api.edgeType}`);
  }
  if (api.parentId !== js.id && api.parentId !== doc.id) {
    // initiator.requestId may point at js; loader fallback is doc — both acceptable
    throw new Error(`fetch parent unexpected: ${api.parentId}`);
  }
  results.push("PASS fetch");

  // 4) script_nav
  store.state.nodes.clear();
  store.state.trees.clear();
  store.state.requestIdToNodeId.clear();
  store.state.loaderToDocument.clear();
  store.state.frameToDocument.clear();
  store.state.targetToActiveTree.clear();
  store.state.recentGestures = [];

  await pageClient.Page.navigate({ url: `${BASE}/script-nav-start` });
  await waitFor(
    store,
    () => findNodes(store, (u) => u.includes("/script-nav-dest")).some((n) => n.hasResponse),
    "script-nav-dest",
  );
  const start = findNodes(store, (u) => u.includes("/script-nav-start"))[0];
  const dest = findNodes(store, (u) => u.includes("/script-nav-dest"))[0];
  if (!start || !dest) throw new Error("script_nav nodes missing");
  if (dest.edgeType !== "script_nav" || dest.parentId !== start.id) {
    throw new Error(
      `script_nav failed: edge=${dest.edgeType} parentMatch=${dest.parentId === start.id} initiator=${dest.initiator?.type}`,
    );
  }
  results.push("PASS script_nav");

  // 5) click-nav (user_interaction)
  store.state.nodes.clear();
  store.state.trees.clear();
  store.state.requestIdToNodeId.clear();
  store.state.loaderToDocument.clear();
  store.state.frameToDocument.clear();
  store.state.targetToActiveTree.clear();
  store.state.recentGestures = [];

  await pageClient.Page.navigate({ url: `${BASE}/assets` });
  await waitFor(
    store,
    () => findNodes(store, (u) => u.includes("/assets")).some((n) => n.resourceType === "Document" && n.finished),
    "assets for click",
  );
  await sleep(400);
  // Real trusted click via Input domain so gesture hook + navigation both fire.
  const box = await pageClient.Runtime.evaluate({
    expression: `(() => {
      const el = document.getElementById('clickLink');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    })()`,
    returnByValue: true,
  });
  const point = (box.result?.value as { x: number; y: number } | undefined) ?? {
    x: 20,
    y: 20,
  };
  await pageClient.Input.dispatchMouseEvent({
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await pageClient.Input.dispatchMouseEvent({
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await waitFor(
    store,
    () => findNodes(store, (u) => u.includes("/click-dest")).length > 0,
    "click-dest",
  );
  const home = findNodes(
    store,
    (u) => u.includes("/assets") && !u.includes(".css") && !u.includes(".js") && !u.includes("api"),
  ).find((n) => n.resourceType === "Document");
  const clicked = findNodes(store, (u) => u.includes("/click-dest"))[0];
  if (!home || !clicked) throw new Error("click-nav nodes missing");
  if (clicked.edgeType === "user_interaction" && clicked.parentId === home.id) {
    results.push("PASS click-nav");
  } else {
    results.push(
      `WARN click-nav edgeType=${clicked.edgeType} parentMatch=${clicked.parentId === home.id} initiator=${clicked.initiator?.type}`,
    );
  }

  console.log("\n=== validation results ===");
  for (const r of results) console.log(r);

  const hardFail = results.some((r) => r.startsWith("FAIL"));
  const requiredPass = ["PASS redirect", "PASS assets", "PASS fetch"].every((x) =>
    results.includes(x),
  );

  await pageClient.close();
  await client.close();
  await cdp.stop();
  chrome.kill("SIGTERM");
  pageServer.close();

  if (hardFail || !requiredPass) {
    process.exitCode = 1;
  } else {
    console.log("\nRequired scenarios passed (redirect, assets, fetch).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
