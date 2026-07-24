import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "ui"), { recursive: true });
cpSync(join(root, "src", "ui"), join(root, "dist", "ui"), { recursive: true });
console.log("copied src/ui → dist/ui");
