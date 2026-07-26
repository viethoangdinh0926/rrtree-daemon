import { CdpManager } from "./cdp/session.js";
import { startServer } from "./api/server.js";
import { TreeStore } from "./model/store.js";

async function main(): Promise<void> {
  const host = process.env.CDP_HOST ?? "127.0.0.1";
  const port = Number(process.env.CDP_PORT ?? 9222);
  const apiPort = Number(process.env.PORT ?? 7733);
  const captureBodies = process.env.CAPTURE_BODIES !== "0";

  const store = new TreeStore();
  const cdp = new CdpManager({ host, port, store, captureBodies });

  // Start scanning immediately; Chrome need not be running yet.
  await cdp.start();
  await startServer({ store, cdp, port: apiPort });
  console.log(`[rrtree] UI: http://127.0.0.1:${apiPort}/`);
  console.log(
    `[rrtree] waiting for Chrome CDP at ${host}:${port} ` +
      `(start Chrome with --remote-debugging-port=${port})`,
  );

  const shutdown = async () => {
    console.log("[rrtree] shutting down…");
    await cdp.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
