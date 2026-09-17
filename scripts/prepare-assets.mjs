// Copies the ZXing barcode reader WASM into public/ so camera scanning never depends
// on a CDN (school web filters often block them). Runs on install, dev, and build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm");
const targetDir = path.join(root, "public", "vendor");

if (!existsSync(source)) {
  console.warn("prepare-assets: zxing_reader.wasm not found; camera scanning will be unavailable.");
} else {
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, path.join(targetDir, "zxing_reader.wasm"));
}
