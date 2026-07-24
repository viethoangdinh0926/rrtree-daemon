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

  console.log(`[rrtree] connecting to Chrome CDP at ${host}:${port} …`);
  try {
    await cdp.start();
  } catch (err) {
    console.error(
      `[rrtree] CDP connect failed. Start Chrome with:\n` +
        `  google-chrome --remote-debugging-port=${port} --user-data-dir=/tmp/rrtree-chrome\n`,
      err instanceof Error ? err.message : err,
    );
    process.exitCode = 1;
    return;
  }

  await startServer({ store, cdp, port: apiPort });
  console.log(`[rrtree] UI: http://127.0.0.1:${apiPort}/`);

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
